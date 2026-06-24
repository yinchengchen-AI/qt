# P2 阶段验收报告

## 完成度

| 设计文档 § | 模块 | 状态 | 验收 |
|---|---|---|---|
| §7 | 消息提醒（领域事件 + 站内信） | ✅ | 21/21 E2E + 8 个事件类型集成 |
| §7 | 定时任务 | ✅ | 4 个 jobs 全部工作 |
| §8 | 统计分析 | ✅ | 5 个接口 + 3 个页面 |
| §8.2 | xlsx 导出 | ✅ | exceljs 4.4.0 流式生成 |
| §6 | 操作日志 | ✅ | 5 模块状态机全覆盖 |
| §6 R-14 | 软删除 | ✅ | customer DELETE 接口 + ENTITY_IMMUTABLE 校验 |
| §3 | 权限矩阵 | ✅ | 修 ADMIN STATISTICS 含 EXPORT |

## 关键设计点落地

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

## 已知设计点

- **消息可能重复**：定时任务每天扫，若 `createdAt < todayStart` 视为新的一天，但没跨天去重。极端情况下 1 小时跑一次可能产生 N 条。P3 加去重表。
- **Sales 客户软删的 row-level 隔离返回 403 而非 404**：因为 SALES 没有 CUSTOMER DELETE 权限。这是权限检查在前的预期行为；想严格返回 404，需把 `requirePermission` 移到 `findFirst` 之后。
- **顶部 `request_user_input` 没启用**：默认决策都是合理的（"按文档进入实现"模式）。

## 性能初步数据

- 5 模块 P1 E2E 27 步：4.0s
- 21 个 P2 断言：2.5s
- 单次 `getOverview` (29 客户 + 7 合同 + 1 开票 + 1 回款)：~150ms
- 单次 `getTimeSeries`（13 个月 + 全表扫）：~80ms

## P3 路线建议

- **SSO / 邮件 / 企业微信**：通知三通道开关位已留（P3 实施）
- **RLS 兜底**：当前 SALES 隔离由 service 层 `ownershipWhere` 注入；P3 可加 PG RLS 策略作为第二道防线
- **审计日志清理**：`OperationLog` 保留 5 年；P3 加 PG 物化或冷归档
- **i18n**：next-intl 4.13.0 已装但未启用；P3 接 en-US
- **Vercel Cron / 外部 scheduler**：jobs API 已就绪
- **压测报告**：200 并发列表查询 P95 < 500ms（设计目标）


## Round-2 修复(统计分析代码审查回归)

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
