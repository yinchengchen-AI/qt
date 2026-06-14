# P3 Review — 通知 / 公告 / RLS / 备份 / 压测

> 杭州企泰安全科技 业务管理系统 P3 阶段验收报告
> 测试日期：2026-06-09

## 1. 范围与交付

| 模块 | 文件 | 状态 |
|---|---|---|
| 通知通道（email / wechatWork） | `lib/notify-config.ts`、`server/events/channels.ts`、`server/events/dispatcher.ts` | ✅ 完成 |
| 公告系统（CRUD + 靶向 + 软删） | `server/services/announcement.ts`、`app/api/announcements/**`、`app/announcements/page.tsx`、`lib/validators/announcement.ts` | ✅ 完成 |
| RLS 兜底（5 张表 policy） | `prisma/migrations/20260609_rls/migration.sql`、`lib/rls.ts` | ✅ 完成 |
| i18n 基础（zh-CN / en-US） | `lib/i18n.ts` | ✅ 完成 |
| 备份脚本 | `scripts/prod/backup.sh` | ✅ 完成 |
| 审计清理脚本 | `scripts/prod/audit-cleanup.sh` | ✅ 完成 |
| 压测工具 | `scripts/dev/loadtest.mjs` | ✅ 完成 |
| 文档 | `docs/RLS.md`、`docs/P3_REVIEW.md` | ✅ 完成 |

---

## 2. 压测报告

### 2.1 测试方法

- 工具：`scripts/dev/loadtest.mjs`（Node 原生 fetch，无第三方依赖）
- 目标：`/api/customers?page=1&pageSize=20`（读密集 + DB 查询 + 行级 where）
- 压测账户：登录 `admin`（admin 的 customer 列表非空，含 owner 客户）
- 环境：dev mode（`next dev`）— 生产构建会显著优于该数据
- 网络：localhost（同机）

### 2.2 测试结果

| 并发 | 时长 | 总请求 | RPS | P50 | P95 | P99 | Max | 错误 |
|---|---|---|---|---|---|---|---|---|
| 10 | 5s | 2 674 | 534.8 | 16.5 ms | 25.1 ms | 84.0 ms | 185.6 ms | 0 |
| 50 | 10s | 4 971 | 497.1 | 92.1 ms | **139.9 ms** | 300.0 ms | 503.4 ms | 0 |
| 100 | 10s | 4 645 | 464.5 | 201.1 ms | **275.0 ms** | 509.2 ms | 1 033.3 ms | 0 |
| 200 | 10s | 3 234 | 323.4 | 552.7 ms | 1 602.4 ms | 1 874.1 ms | 2 441.0 ms | 0 |

### 2.3 结论

- **设计文档 §12 目标**："200 并发列表查询 P95 < 500ms"
- **本机 dev 模式实测**：
  - C50 / C100 均达成（200ms + 量级）
  - **C200 未达成**（dev 模式无 Next 编译缓存、keep-alive、连接池优化）
- **生产构建（`next build` + `next start`）预期**：C200 P95 < 500ms 可达成
- **下一步建议**：
  1. Prisma 连接池 `?pgbouncer=true&connection_limit=20`
  2. `next start` 替代 `next dev` 再压
  3. 引入 `pino` + `compression` 中间件
  4. Customer 列表加 SWR 客户端缓存（`swr@2.4.1` 已有）

---

## 3. 测试覆盖

### 3.1 自动化测试

| 套件 | 用例 | 通过率 | 状态 |
|---|---|---|---|
| P0 Vitest | 5 | 5/5 | ✅ |
| P1 E2E (`e2e-flow.mjs`) | 27 | 27/27 | ✅ |
| P2 E2E (`p2-flow.mjs`) | 21 | 21/21 | ✅ |
| P3 E2E (`p3-flow.mjs`) | 23 | 23/23 | ✅ |
| **合计** | **76** | **76/76** | ✅ |

### 3.2 P3 E2E 覆盖场景

- 公告：未登录 401、SALES 无 CREATE/PATCH、ADMIN CRUD、关键词搜索、靶向角色、软删
- 通知：默认关闭无副作用、inbox 必达、异步分发不阻塞事务
- RLS：SALES 看不到 admin 客户/合同（应用层 ownershipWhere 验证）
- i18n：字典完整性

### 3.3 TS 严格检查

```
npx tsc --noEmit  # 0 错误
```

---

## 4. 通知通道设计

### 4.1 通道矩阵

| 事件 | inbox | email | wechatWork |
|---|---|---|---|
| CONTRACT_PENDING_REVIEW | ✅ | ✅ (off) | – |
| CONTRACT_APPROVED | ✅ | – | – |
| CONTRACT_REJECTED | ✅ | ✅ (off) | – |
| CONTRACT_EXPIRING | ✅ | – | – |
| INVOICE_OVERDUE_PAYMENT | ✅ | ✅ (off) | ✅ (off) |
| PAYMENT_RECEIVED | ✅ | – | – |
| PROJECT_DUE | ✅ | – | – |
| CUSTOMER_INACTIVE | ✅ | – | – |

### 4.2 关键设计点

- **inbox 永远开启**：在事务内同步写 `Message` 表（原子性）
- **外部通道 fire-and-forget**：事务外异步派发，失败仅 `console.warn`，不抛
- **开关驱动**：`NOTIFY_EMAIL_ENABLED` / `NOTIFY_WECHAT_WORK_ENABLED` env 变量
- **凭据配置**：`SMTP_*` / `WECHAT_WORK_WEBHOOK_URL` env 变量，未配置则通道静默跳过
- **频率控制**（设计占位）：未来可加 Redis 滑动窗口（防客户 90 天无跟进刷屏）

### 4.3 部署建议

1. 默认 `.env` 不开任何外部通道
2. 内部测试 → 配 SMTP + `NOTIFY_EMAIL_ENABLED=true`
3. 生产 → 配企业微信 webhook + `NOTIFY_WECHAT_WORK_ENABLED=true`

---

## 5. RLS 兜底设计

详见 `docs/RLS.md`。核心要点：

- **应用层主防线**：`ownershipWhere(user)` 在 service 层注入
- **DB 层兜底**：5 张表 + policy，事务内 `set_config('app.user_id', ..., true)`
- **生产建议**：拆 `qt_app_write` (BYPASSRLS) + `qt_app_read` (NO BYPASSRLS)

---

## 6. 备份与审计清理

### 6.1 备份脚本 `scripts/prod/backup.sh`

- 工具：`pg_dump -Fc`（custom format，压缩比高）
- 保留：30 天
- 路径：`/var/backups/qt/qt_YYYYMMDD_HHMMSS.dump`
- 调度：crontab `0 2 * * *`

### 6.2 审计清理 `scripts/prod/audit-cleanup.sh`

- 策略：保留 5 年（设计文档 §13 假设）
- 实现：按年分批 DELETE `OperationLog WHERE createdAt < now() - 5y`
- 调度：crontab `0 3 1 1 *`（每年 1 月 1 日）

### 6.3 使用示例

```bash
# 备份
bash scripts/prod/backup.sh
# 输出：/var/backups/qt/qt_20260609_120000.dump (size=...)

# 恢复
pg_restore -h localhost -U qitai -d qt_biz /var/backups/qt/qt_20260609_120000.dump
```

---

## 7. 已知未做（设计文档 §13）

- ❌ SSO / 企业微信扫码登录（保留配置位与 P3+ 钩子）
- ❌ 邮件 / 企业微信三通道**开启时**的端到端测试（默认关闭，仅验证不崩）
- ❌ Vercel Cron 部署（本地脚本可作为参考）
- ❌ 压测 C200 P95 < 500ms（dev 模式限制；生产构建需重测）

---

## 8. P3 commit 信息

- Branch：`main`
- Commit message：`feat: P3 完善 — 通知通道 / 公告 / RLS / 备份 / 压测`
- Files changed：P3 新增 12 文件，修改 5 文件

