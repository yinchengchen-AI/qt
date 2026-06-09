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
- 业务员业绩：按 SALES 角色自动行级隔离

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

