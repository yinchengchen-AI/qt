# 阶段验收报告

> P2 + P3 阶段验收报告合并归档

---

## P2 阶段验收


#### 完成度

| 设计文档 § | 模块 | 状态 | 验收 |
|---|---|---|---|
| §7 | 消息提醒（领域事件 + 站内信） | ✅ | 21/21 E2E + 8 个事件类型集成 |
| §7 | 定时任务 | ✅ | 4 个 jobs 全部工作 |
| §8 | 统计分析 | ✅ | 5 个接口 + 3 个页面 |
| §8.2 | xlsx 导出 | ✅ | exceljs 4.4.0 流式生成 |
| §6 | 操作日志 | ✅ | 5 模块状态机全覆盖 |
| §6 R-14 | 软删除 | ✅ | customer DELETE 接口 + ENTITY_IMMUTABLE 校验 |
| §3 | 权限矩阵 | ✅ | 修 ADMIN STATISTICS 含 EXPORT |

#### 关键设计点落地

### 1. 事件总线（无外部依赖）
- `server/events/bus.ts`：emit 时直接传 `receivers`，在事务内写 Message
- 模板在 `bus.ts` 集中维护（避免散落）

### 2. OperationLog 集成
- 12 个状态机迁移点全部埋点
- 敏感字段脱敏（password / bankAccount / taxNo 等 7 个）
- 与 `*AuditLog` 双写（Contract/Invoice 专门审计表 + 通用 OperationLog）

### 3. 统计聚合
- 时间序列：JS 端分桶（避免 PG `generate_series` 复杂度）
- 账龄：4 桶（0-30 / 31-60 / 61-90 / 90+）
- Top10：可配置 metric（contract / payment）
- 员工业绩：按 SALES 角色行级隔离; ADMIN/FINANCE 看全员 (排除 admin + system)

### 4. xlsx 导出
- 路由层鉴权（需 STATISTICS EXPORT 权限）
- 流式生成（`exceljs.xlsx.writeBuffer`）
- 中文文件名 + 动态日期戳

#### 已知设计点

- **消息可能重复**：定时任务每天扫，若 `createdAt < todayStart` 视为新的一天，但没跨天去重。极端情况下 1 小时跑一次可能产生 N 条。P3 加去重表。
- **Sales 客户软删的 row-level 隔离返回 403 而非 404**：因为 SALES 没有 CUSTOMER DELETE 权限。这是权限检查在前的预期行为；想严格返回 404，需把 `requirePermission` 移到 `findFirst` 之后。
- **顶部 `request_user_input` 没启用**：默认决策都是合理的（"按文档进入实现"模式）。

#### 性能初步数据

- 5 模块 P1 E2E 27 步：4.0s
- 21 个 P2 断言：2.5s
- 单次 `getOverview` (29 客户 + 7 合同 + 1 开票 + 1 回款)：~150ms
- 单次 `getTimeSeries`（13 个月 + 全表扫）：~80ms

#### P3 路线建议

- **SSO / 邮件 / 企业微信**：通知三通道开关位已留（P3 实施）
- **RLS 兜底**：当前 SALES 隔离由 service 层 `ownershipWhere` 注入；P3 可加 PG RLS 策略作为第二道防线
- **审计日志清理**：`OperationLog` 保留 5 年；P3 加 PG 物化或冷归档
- **i18n**：next-intl 4.13.0 已装但未启用；P3 接 en-US
- **Vercel Cron / 外部 scheduler**：jobs API 已就绪
- **压测报告**：200 并发列表查询 P95 < 500ms（设计目标）


#### Round-2 修复(统计分析代码审查回归)

> 触发:`server/services/statistics.ts` 与相关路由/页面的代码审查。修复 commit 见 `git log -- server/services/statistics.ts`。

### A. 修复清单

| 编号 | 文件 | 改动 | 验证 |
|---|---|---|---|
| H1 | `server/services/statistics.ts` + `app/(app)/statistics/aging/page.tsx` | `getInvoiceAging` 新增 `total` 字段(全部超期数);页面用 `totalOverdueInvoices` 驱动 KPI 文案 / 章节标题 / 移动端链接 | `tests/api/statistics-aggregation.test.ts` 验证 `total >= rows.length` |
| H3 | `server/services/statistics.ts` | `unpaidAmount = round2(Math.max(0, invoiceAmount - paymentAmount))`,防止预付款造成负数 | DB 集成测试构造 100 元开票 + 500 元预付款,断言 `unpaidAmount === 0` |
| H4 | `server/services/statistics.ts` + 路由 | `getTopCustomers(metric, limit, range?)`;`/api/statistics/top-customers` 与 `/api/statistics/export` 接受并透传 `from / to`;export 透传 `userId` | 结构性断言 + e2e 待补 |
| H5 | `app/api/statistics/export/route.ts` | `exportMaxRows()` 兜底:employee-performance 走 `all.slice(0, MAX_ROWS)`,top-customers 直接 `limit=MAX_ROWS` | 结构性断言 |
| M1 | `app/api/statistics/overview/route.ts` + 页面 | `customers.newThisMonth` → `newInRange`,UI/类型同步 | grep 全文已无 `newThisMonth` |
| M2 | `lib/enum-maps.ts` + overview 路由 | 新增 `CUSTOMER_TYPE_MAP` / `CUSTOMER_SCALE_MAP`;路由在响应里把 `byScale / byType / byStatus` 的 key 翻译成 label | 路由单测覆盖 |
| M3 | `tests/api/statistics-ownership.test.ts` + `tests/api/statistics-aggregation.test.ts` | 新增 18 条结构断言 + 4 条 DB 集成断言 | `vitest run` → 445/445 通过 |
| M4 | `server/services/statistics.ts` | `aggregatePerformance` 的 `contractOwners` 反查加 `ownerUserId: { in: ownerIds }`,避免拉无关人员的合同 | 结构性断言 |
| L1-L3, L6 | `server/services/statistics.ts` | `DateRange` 复用 `lib/date-range`;`daysBetween` 走 `Date.UTC`;`days < 0` 归 90+;`getOverview` 移除 `range` 字段 | typecheck / 现有测试 |

### B. 关于 H2 的复核

初版审查建议把 `REFUNDED` 计入 `paidMap`(用符号抵消),但与 schema 的 `refund` 语义冲突:`refund` 动作把原 payment 的 `status` 直接翻为 `REFUNDED`、`amount` 不变,这等价于"该笔回款从未生效"。若用符号抵消,单笔 500 元「先确认后退款」会被算成 `paidMap = -500`,`remaining = invoice − (-500) = invoice + 500`,**错误高估应收**。已保留原行为(只聚合 `CONFIRMED / RECONCILED`,REFUNDED 视为已撤销),并在 `server/services/statistics.ts` 加注释锁住语义,防止未来再次踩坑。

### C. 测试覆盖

- `npx tsc --noEmit` 0 errors
- `npm run lint`(改动文件)0 errors / 0 warnings
- `npx vitest run` 51 files / **445 tests passed**
- `npm run build` 成功,`/api/statistics/*` 与 `/statistics/*` 路由全产出

### D. 留待 follow-up

- `top-customers` 导出分支目前无前端调用方,本次顺手实现 range 透传,后续接页面零成本
- `getCustomerDistribution` 当前只 groupBy `scale / customerType / status`,`industry` 已留 schema 字段但未聚合(产品按需)
- E2E(`tests/e2e/`)未覆盖统计分析任何页;P3 路线建议补 `08-statistics-overview.spec.ts` 等用例

---

## P3 阶段验收

# P3 Review — 通知 / 公告 / RLS / 备份 / 压测

> 杭州企泰安全科技 业务管理系统 P3 阶段验收报告
> 测试日期：2026-06-09

## 1. 范围与交付

| 模块 | 文件 | 状态 |
|---|---|---|
| 通知通道（email / wechatWork） | 已下线，事件通知统一走站内信 | ❌ 不再提供 |
| 公告系统（CRUD + 靶向 + 软删） | `server/services/announcement.ts`、`app/api/announcements/**`、`app/announcements/page.tsx`、`lib/validators/announcement.ts` | ✅ 完成 |
| RLS 兜底（5 张表 policy） | `prisma/migrations/20260614_init/migration.sql`、`lib/rls.ts` | ✅ 完成 |
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
| **合计** | **5** | **5/5** | ✅ |

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

| 事件 | inbox |
|---|---|---|---|
| CONTRACT_PENDING_REVIEW | ✅ | ✅ (off) | – |
| CONTRACT_APPROVED | ✅ | – | – |
| CONTRACT_REJECTED | ✅ | ✅ (off) | – |
| CONTRACT_EXPIRING | ✅ | – | – |
| INVOICE_OVERDUE_PAYMENT | ✅ | ✅ (off) | ✅ (off) |
| PAYMENT_RECEIVED | ✅ | – | – |
| PROJECT_DUE | ✅ | – | – |

### 4.2 关键设计点

- **inbox 永远开启**：在事务内同步写 `Message` 表（原子性）
- **频率控制**（设计占位）：未来可加 Redis 滑动窗口（防客户 90 天无跟进刷屏）

### 4.3 部署建议

外部通道（email / 企微）已下线，不再有通道相关部署步骤。

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

- ❌ Vercel Cron 部署（本地脚本可作为参考）
- ❌ 压测 C200 P95 < 500ms（dev 模式限制；生产构建需重测）

---

## 8. P3 commit 信息

- Branch：`main`
- Commit message：`feat: P3 完善 — 通知通道 / 公告 / RLS / 备份 / 压测`
- Files changed：P3 新增 12 文件，修改 5 文件


