# 合同"假完结"数据修复方案

**修复日期**：2026-06-29
**影响合同数**：242 个
**应收未结合计**：¥2,692,907.97
**修复方式**：CLOSED → ACTIVE（绕过业务层，无 reopen 接口）

---

## 一、问题背景

### 1.1 现象

业务侧报告：部分合同状态为 CLOSED（已完结）但回款还未结清，财务在录入回款时系统报 `VALIDATION_FAILED: 合同 X 当前状态 CLOSED，不可登记回款（须 ACTIVE）`。

### 1.2 根因（已定位）

| 时间段 | 事件 |
|---|---|
| 2025-09 之前 | cron `/api/jobs/run-all` 正常每日运行 |
| 2025-09 ~ 2026-06-21 | **cron 停了 9 个月**（具体根因待复盘）|
| 2026-06-22 17:00 | cron 恢复扫描，给大量合同打 `AUTO_EXPIRE` 标记 |
| 2026-06-25 ~ 26 | `tryAutoClose` 试双足额完结，绝大部分 SKIPPED（钱没齐）|
| 2026-06-26 10:00 | `tryAutoCloseOnOverdue` 触发：`endDate + 60 天宽限期 < now` + 未结清 → **AUTO_CLOSE_OVERDUE_TERMINATED** |

强关代码逻辑（`server/services/contract/status.ts:279`）：
```ts
const graceCutoff = new Date(new Date(c.endDate).getTime() + graceMs);
if (graceCutoff >= now) throw new SkipTransition(); // 还在宽限期内就不关
```

### 1.3 影响面

| 关闭方式 | 合同数 | 合同总额 | 未结清 | 备注 |
|---|---|---|---|---|
| `overdue_terminated`（cron 强关）| 209 | 207 万 | 156 万 | 系统自动关闭 |
| `reviewComment` 为空（admin 手动关）| 31 | 407 万 | 110 万 | 早期 admin 直接 SQL 关 |
| `completed`（自然完结但钱没齐）| 2 | 8.5 万 | 3 万 | 异常，疑似历史 bug |
| **合计** | **242** | | **269 万** | |

代码硬限（`server/services/payment.ts:84`）：
```ts
if (contract.status !== "ACTIVE") {
  throw new ApiError(... "不可登记回款（须 ACTIVE）" ...);
}
```
**没有任何 admin 旁路**。

---

## 二、修复方案

### 2.1 设计取舍

不直接"reopen"的原因：
- 代码里没 `reopenContract` 接口（产品功能缺失）
- 没 `createPayment` 的 admin 旁路
- 临时实现一个 reopen 接口需要走 PR 流程（紧急情况来不及）

选择方案：**直接 SQL 改状态 + 备份 + 审计痕迹**。
- 优点：立即可用，不依赖代码改动
- 缺点：绕开业务层，未来需要补 reopen 接口避免再次出现死锁

### 2.2 修复动作

| 动作 | 内容 |
|---|---|
| 备份 | 复制 242 条合同的原始 CLOSED 状态到 `Contract_fake_close_recovery_20260629` 表 |
| 审计 | 写入 242 条 `ContractReviewLog` 记录，`action='MANUAL_REOPEN'`，comment 注明触发原因 |
| 主改 | `Contract.status: CLOSED → ACTIVE`，`reviewComment='recovered_from_fake_close'` 作为审计标记 |
| 校验 | UPDATE 影响行数 == 目标数；残留假完结合同数 == 0 |
| 输出 | 按应收未结降序打印清单（财务对账用）|

### 2.3 后续自然完结

改回 ACTIVE 后：
- `tryAutoClose` 会按规则重评（`endDate < now + 开票足额 + 回款足额`）
- 钱齐了的合同会自动完结成 CLOSED（reason=completed）—— 这是预期的
- 没齐钱的合同继续保持 ACTIVE，财务可以继续录

### 2.4 不影响的事项

- `reviewComment` 改为 `recovered_from_fake_close` 后，不会被 `tryAutoClose` 清除
  （auto close 的 reason 走的是 `extraData.reviewComment`，会覆盖）
- 备份表 `Contract_fake_close_recovery_20260629` 保留 90 天后再清理
- ContractReviewLog 的 `MANUAL_REOPEN` 是新 action，不影响状态机

---

## 三、执行步骤

### 推荐：用可执行脚本（带 dry-run + 事务）

```bash
cd /opt/qt
# 1) 备份整库
pg_dump -Fc qt_biz > /backup/qt_biz_20260629.dump

# 2) 暂停 cron
sudo systemctl stop qt-app

# 3) DRY-RUN 预览
pnpm tsx scripts/migrate/contract-fake-close-recovery.ts --dry-run

# 4) 实际执行 (5 秒倒计时, 可 Ctrl+C 取消)
pnpm tsx scripts/migrate/contract-fake-close-recovery.ts --execute

# 5) 启动应用
sudo systemctl start qt-app
```

### 备选：纯 SQL

```bash
# 1) 编辑脚本, 把 |||OPERATOR_USER_ID||| 替换成 admin 用户 ID
vim scripts/migrate/contract-fake-close-recovery.sql

# 2) 备份 + 暂停 cron (同上)

# 3) 执行
psql -U qt_app -d qt_biz -f scripts/migrate/contract-fake-close-recovery.sql
```

### 回滚（如需）

```sql
BEGIN;
  UPDATE "Contract" c
  SET status = b.status,
      "reviewComment" = b."reviewComment",
      "updatedById" = b.closed_by,
      "updatedAt" = b.closed_at
  FROM Contract_fake_close_recovery_20260629 b
  WHERE c.id = b.id;

  DELETE FROM "ContractReviewLog"
  WHERE id LIKE 'crrl_recover_%';
COMMIT;
```

---

## 四、长期方案（防止再发生）

### 4.1 代码层

1. **`reopenContract` 接口**：`app/api/contracts/[id]/reopen/route.ts`
   - admin 专属：CLOSED → ACTIVE
   - 强制走完整审计 + 通知
   - 复用 `lib/status-machine.ts` 的 `runTransition`
2. **`createPayment` admin 旁路**：`server/services/payment.ts`
   - 加 `force: true` 参数，仅 admin 可用
   - 落 audit log 明确标 `FORCE_BACKFILL`
3. **强关前预警**：`server/jobs/contract-automation.ts`
   - `tryAutoCloseOnOverdue` 命中前 7/3/1 天发通知，给财务最后一次补单机会

### 4.4 未来 reopen vs force 业务选择指南

`reopenContract` 与 `createPayment({ force: true })` 是两条独立路径，未来类似事件怎么选：

| 场景 | 推荐路径 | 原因 |
|---|---|---|
| **历史合同批量恢复 + 补录**（典型：cron 误关） | 直接 SQL 跑 `contract-fake-close-recovery.ts`（同本次） | 数据量大（百+），跑 API 太慢；恢复 + 补录是两个动作但 SQL 一次性处理最简单 |
| **单合同 admin 误关**（手抖） | `POST /api/contracts/[id]/reopen` → 状态回 ACTIVE → 走正常流程 | 后续 cron 不会再误关（条件已变）；完整审计 trail |
| **CLOSED 合同上有未结清付款要补录**（场景 1 残留 / 旧合同归档遗漏） | `POST /api/payments` body 加 `force: true` + `forceReason` | 不改合同状态（保持 CLOSED），仅 admin 可用，remark 自动追加 `[FORCE_BACKFILL:<reason>]` 审计标记 |
| **DRAFT/其它非 ACTIVE 非 CLOSED 合同要录付款** | **拒绝**（force 旁路不适用） | 业务上没意义，强制会被服务层 422 拦下 |

**关键提醒**：

- `reopen` 后如果合同仍满足 `tryAutoCloseOnOverdue` 条件（endDate + GRACE_DAYS < now + 未结清），下次 cron 跑还会再次强关。**正确流程是 reopen → 立即补录付款 → 让 tryAutoComplete 走 completed 路径**。
- `force` 不改合同状态（仍 CLOSED），所以**不影响未来 cron 行为**。适合"只需要录入付款的尾部动作"，不适合"要让合同回到业务流转"。

### 4.5 接口参考

```bash
# 1. reopen (admin 专属, CLOSED → ACTIVE)
curl -X POST http://app.example.com/api/contracts/<id>/reopen \
  -H "Cookie: <admin-session>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"recovered_from_fake_close","reasonNote":"cron 9 月静默失败回滚"}'

# 2. force payment (admin 专属, 仅 CLOSED 合同可用)
curl -X POST http://app.example.com/api/payments \
  -H "Cookie: <admin-session>" \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "<id>",
    "amount": "555340.00",
    "receivedAt": "2026-06-29T10:00:00Z",
    "remark": "余杭径山镇政府 第 1 期",
    "force": true,
    "forceReason": "recovered_from_fake_close: 历史应收补录"
  }'
```

### 4.2 运维层

1. **cron 健康监控**：连续 2 天 `/api/jobs/run-all` 没成功 → 飞书/钉钉告警
2. **cron 失败根因复盘**：查 2025-09 期间 deploy / 容器重启 / 系统迁移历史
3. **备份恢复演练**：每季度演练一次"备份→恢复→对账"流程

### 4.3 业务层

1. **合同关闭前确认**：admin 强关时必须填 `reason`（已有约束），但还要确认无未结清付款
2. **关键客户白名单**：政府单位等大客户合同，加白名单或拉长宽限期

---

## 五、附：242 个合同清单

见 `docs/contract-fake-close-recovery-list.csv`（按应收未结降序）

按金额 Top 10：
| 合同号 | 客户 | 总额 | 已回款 | 应收未结 |
|---|---|---|---|---|
| QT-HT-2026-3033 | 杭州市余杭区径山镇人民政府 | 828,000 | 272,660 | **555,340** |
| QT-HT-2026-3113 | 杭州市余杭区人民政府五常街道办事处 | 1,786,666 | 1,339,999 | **446,666** |
| QT-HT-2026-3105 | 杭州市余杭区瓶窑镇人民政府 | 1,468,000 | 1,095,000 | **373,000** |
| QT-HT-2026-1440 | 杭州市余杭区人民政府中泰街道办事处 | 150,000 | 0 | **150,000** |
| QT-HT-2026-3087 | 浙江余杭经济开发区管理委员会 | 250,000 | 125,000 | **125,000** |
| QT-HT-2026-3030 | 杭州市余杭区瓶窑镇人民政府 | 95,000 | 0 | **95,000** |
| QT-HT-2026-3036 | 杭州市余杭区径山镇人民政府 | 49,600 | 0 | **49,600** |
| QT-HT-2026-3035 | 杭州市余杭区径山镇人民政府 | 48,800 | 0 | **48,800** |
| QT-HT-2026-3034 | 杭州市余杭区径山镇人民政府 | 46,400 | 0 | **46,400** |
| HZQT20240196 | 杭州云墨智谷新材料科技发展有限公司 | 75,000 | 37,500 | **37,500** |

---

## 六、文件清单

| 路径 | 用途 |
|---|---|
| `docs/contract-fake-close-recovery.md` | 本文档 |
| `docs/contract-fake-close-recovery-list.csv` | 242 个应收未结合同清单 |
| `scripts/migrate/contract-fake-close-recovery.sql` | 纯 SQL 修复脚本 |
| `scripts/migrate/contract-fake-close-recovery.ts` | 可执行 TS 修复脚本（推荐）|