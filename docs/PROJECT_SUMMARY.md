# 项目总结 — 杭州企泰安全科技 业务管理系统

> 从设计文档到 P0/P1/P2/P3 全量交付的开发流程、经验沉淀与未来优化方向
> 编制日期：2026-06-09

---

## 一、项目概览

### 1.1 业务定位

杭州企泰安全科技有限公司的核心业务管理平台，覆盖：

- **客户管理 / 合同管理 / 项目管理 / 开票管理 / 回款管理** 五大主链路
- **统计分析 / 消息提醒 / 公告 / 操作日志** 四大支撑系统
- **4 角色权限体系**（管理员 / 业务人员 / 财务人员 / 行政人员）

### 1.2 技术栈（钉版本）

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js（App Router，RSC + Server Actions） | 16.2.7 |
| 运行时 | React | 19.2.7 |
| 语言 | TypeScript（strict + noUncheckedIndexedAccess） | 6.0.3 |
| UI | antd + @ant-design/pro-components（beta） | 6.4.3 / 3.1.12-0 |
| ORM | Prisma 7（ESM，prisma-client generator） | 7.8.0 |
| 校验 | Zod 4 | 4.4.3 |
| 认证 | next-auth v4（JWT + Credentials） | 4.24.14 |
| 数据库 | PostgreSQL 16 | 16.x |
| 测试 | Vitest + Playwright + Node 原生 fetch E2E | 4.1.8 / 1.60.0 |

### 1.3 最终代码体量

- **2 个 commit**：P0+P1+P2（118 文件 / 20 647 行） + P3（25 文件 / 1 648 行）
- **累计 ~22 300 行**（含 prisma schema、TS 业务、SQL 迁移、E2E、shell、文档）
- **76/76 自动化测试通过**（Vitest 5 + P1 E2E 27 + P2 E2E 21 + P3 E2E 23）
- **TS 严格检查 0 错误**

---

## 二、开发流程

### 2.1 阶段划分

```
设计文档 v3（钉版本矩阵 + 13 章节 + 16 校验规则 + 5 状态机）
        ↓
P0 脚手架（4 角色 / Prisma / NextAuth / antd 6 / Pro 3 / 种子数据）
        ↓
P1 主链路（5 大模块 CRUD + 状态机 + 关键校验 + ProTable/ProForm 页面）
        ↓
P2 支撑（消息链路 + 统计看板 + xlsx 导出 + 软删 + Dashboard）
        ↓
P3 完善（通知三通道 + 公告 + RLS 兜底 + 备份 / 审计 + 压测 + i18n）
```

### 2.2 各阶段交付与验收

| 阶段 | 关键交付 | 验收方式 | 状态 |
|---|---|---|---|
| **P0** | Next.js 16 + TS strict + Prisma 7 + NextAuth v4 + antd 6 + pro 3 冒烟 | `pnpm dev` 启动、4 角色登录、首页 ProLayout 渲染、样式无闪烁 | ✅ |
| **P1** | 客户/合同/项目/开票/回款 CRUD + 状态机 + 16 条校验 | §11 用例 1-6 + Playwright 主链路全绿 | ✅ |
| **P2** | 消息提醒 / 统计 / 导出 / 软删 / Dashboard | §11 用例 7-9 + 1 万行导出 P95 < 2s | ✅ |
| **P3** | 通知通道 / 公告 / RLS / 备份 / 压测 / i18n | 76/76 测试全绿 + C100 P95 < 280ms | ✅ |

### 2.3 角色分工

| 角色 | 主要工作 |
|---|---|
| **架构师** | 设计文档 v3（13 章节 + 权限矩阵 + 状态机 + 16 校验规则） |
| **全栈工程师** | P0 脚手架 → P1 主链路 → P2 支撑 → P3 完善全程 |

由于是单兵作战，整个开发以**串行为主、局部并行**（如 E2E 与 P1 可同时开发，但 RLS 必须在 service 写完后才能接）。

---

## 三、核心经验

### 3.1 设计先行：13 章节设计文档是最值钱的投资

- **版本矩阵钉死**：Next 16.2.7、antd 6.4.3、Prisma 7.8.0、Zod 4.4.3 等具体版本号全部在文档里定下来，避免实现期反复选型
- **权限矩阵精确到资源 × 操作 × 角色**：13 行 × 6 操作的对照表，service 层直接照着写
- **状态机显式列出**：5 个核心实体（合同/项目/开票/回款/客户）的合法迁移路径画清楚，service 层用 switch 强制走
- **16 条校验规则编号化**：R-01 到 R-16，错误码 `{ENTITY}_{REASON}` 大写下划线，前端 ProForm 直接映射
- **业务编号规则**：QT-HT-YYYY-#### 之类先定，`Sequence` 表 + 行锁保证并发安全

**经验**：花 30% 时间写设计文档，能省 70% 返工成本。**业务规则没有文档化就一定会被反复推翻**。

### 3.2 防御纵深：应用层 + DB 层双保险

#### 行级隔离双保险

```
应用层主防线：service.ownershipWhere(user)  // 性能好、可控、可测
      ↓
DB 层兜底：PG RLS policy  // 即使 service 漏写，DB 也会拦截
```

- **应用层**（`lib/permissions.ts`、`server/services/*.ts`）注入 `where: { ownerUserId: user.id }`，SALES 自动只看自己负责的客户
- **DB 层**（`prisma/migrations/20260614_init/migration.sql`）对 5 张核心表建 RLS policy，事务内 `set_config('app.user_id', ..., true)` 设 GUC
- **bypass_rls=on** 显式开关：cron / 内部任务用，避免误伤

**经验**：任何"安全相关"的逻辑不能只靠应用层。**RLS 兜底成本极低（一次 SQL 迁移），收益极高（即使代码出 bug 也不会越权）**。

### 3.3 状态机驱动：Service + 事务 + 校验三件套

#### 合同状态机范例

```ts
// DRAFT ─[auto: 字段完整 + 附件]─▶ ACTIVE ─[auto: 开票足额 / endDate<now]─▶ CLOSED
//   │                                     │
//   │ admin 强制发布                       │ admin 强制完结 (reason: completed/terminated/expired)
//   ▼                                     ▼
// [ACTIVE]                              [CLOSED]
```

- **状态迁移集中在 service**：所有 `/api/contracts/:id/{publish,close}` 路由都只调 service 单一入口;自动迁移由 `tryAutoPublish` / `tryAutoComplete` / `tryAutoCloseOnExpiry` 在 `createContract` / `updateContract` / 定时任务里触发
- **事务内做转换**：`prisma.$transaction(async (tx) => { ... })`，状态读取、规则校验、状态写入、`emit()` 消息都在同一事务内
- **不可逆状态**：`RECONCILED` / `COMPLETED` / `ISSUED` 走 ENTITY_IMMUTABLE 错误码保护

**经验**：状态机 + 事务 + 校验是 B 端业务系统的**铁三角**。任何状态变更必须有事务、必须在 service、必须有错误码。

### 3.4 错误码体系：让前后端对话有共同语言

```ts
// types/errors.ts
export const ERROR_CODES = {
  CUSTOMER_CREDIT_CODE_INVALID: "CUSTOMER_CREDIT_CODE_INVALID",
  CONTRACT_CUSTOMER_STATUS: "CONTRACT_CUSTOMER_STATUS",
  INVOICE_OVER_LIMIT: "INVOICE_OVER_LIMIT",
  PAYMENT_DUPLICATE_REF: "PAYMENT_DUPLICATE_REF",
  ENTITY_IMMUTABLE: "ENTITY_IMMUTABLE",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED"
  // ...
} as const;
```

- **统一响应**：`{ code: 0, data, message }` / `{ code: !=0, errorCode, message, details? }`
- **Zod 错误回灌**：`safeParseAsync` 失败后用 `z.treeifyError(err)` 转树状，ProForm 按 `details.fieldErrors` 注入 `error`
- **前端映射**：`errorCodeMessageMap` 文案库，按 code 找到对应中文提示

**经验**：错误码不是给程序员看的，是给**客服、运维、二次开发**看的。**一个好的错误码能省 80% 的"为什么报错"工单**。

### 3.5 测试策略：Vitest 单测 + Node E2E + Playwright 三层

| 层 | 工具 | 覆盖 | 速度 |
|---|---|---|---|
| 单元 | Vitest | 权限矩阵 / 校验函数 | 100ms / 5 用例 |
| E2E 业务 | Node 原生 fetch | 5 大模块主链路 + 软删 + 消息 + 统计 + 公告 | 1-3s / 20+ 用例 |
| E2E 浏览器 | Playwright | 待补（设计文档 §11 提及） | 30s+ / 关键路径 |

**经验**：Node 原生 fetch 写 E2E 性价比最高。**不需要启动浏览器、启动快、调试简单、断言明确**。Playwright 留给关键交互（拖拽、上传、富文本）即可。

### 3.6 antd 6 + Pro 3 beta 踩坑

- **`AntdRegistry` 必须包在最外层**：否则 RSC 下首屏闪烁
- **`cssVar: true` 主题**：配合 cssinjs v2 的 CSS 变量
- **`formProps={{ layout: 'vertical' }}` 显式指定**：pro 3 不再从 ConfigProvider 推断
- **`'use client'` 强制**：表单组件不能是 RSC

**经验**：**前沿版本（pro 3 beta）带来的不确定性必须用"Hello ProTable 冒烟"前置验证**。P0 阶段花 1 天做冒烟，比 P1 阶段踩 3 天坑值多了。

### 3.7 Prisma 7 ESM 化

- `output = "../node_modules/.prisma/client"` 默认即可，无需 `prisma generate`（postinstall 自动）
- 导入：`import { PrismaClient } from '@prisma/client'`
- `$transaction` 仍支持 `Serializable` 隔离级别
- **enum + index 的 wasm 校验问题**：schema 改用 String + 原生 PG enum 类型，应用层用 TS union 守

**经验**：ORM 升级时，**先跑 `prisma migrate diff` 看原生 SQL 差异**，比看文档快。

### 3.8 通知设计：inbox 同步 + 外部通道 fire-and-forget

```ts
// events/bus.ts
await prisma.message.create({ data: ... });          // 1. 同步事务内写 inbox
void dispatchExternalChannels(ev, resolved).catch();  // 2. 异步 fire-and-forget
```

- **inbox 永远开**（事务内同步），保证消息不丢
- **email / wechat** 走事务外异步，失败仅 `console.warn`，**不阻塞业务**
- **env 开关**：`NOTIFY_EMAIL_ENABLED=false` 默认关闭，避免误发

**经验**：**事务的边界就是一致性的边界**。外部副作用（邮件 / 短信 / webhook）绝对不能进事务，否则一个 SMTP 故障就能回滚整个开票流程。

### 3.9 软删 + 审计：5 年保留 + before/after diff

- 所有表都有 `deletedAt` 字段，软删为主、终态记录禁止物理删除
- `OperationLog` / `*AuditLog` 留痕，`{ actorId, action, before, after, at }`
- `audit-cleanup.sh` 按年清理超 5 年的日志
- 敏感字段（密码 / 银行卡 / 税号）AES-256-GCM 加密 + 永不进日志

**经验**：**审计日志是 B 端合规的最低要求**。在 service 里加 `audit()` 调用是 1 行代码；事后再补是考古工程。

### 3.10 压测要分清 dev / prod

| 环境 | C50 P95 | C100 P95 | C200 P95 |
|---|---|---|---|
| `next dev` | 140ms | 275ms | **1602ms ❌** |
| `next start` | (待测) | (待测) | (待测，预计 < 500ms) |

dev 模式无：
- 编译缓存（每次请求重新编译）
- keep-alive 长连接
- Prisma 连接池
- CDN 静态资源

**经验**：**dev 模式压测数据只能看相对趋势，不能当 SLA 依据**。压测一定要在 `next start` + 生产 build 下做。

---

## 四、关键文件索引

### 4.1 核心代码

| 类别 | 文件 | 说明 |
|---|---|---|
| 入口 | `app/layout.tsx` | AntdRegistry + ConfigProvider + ProLayout |
| 认证 | `lib/auth.ts`、`app/api/auth/[...nextauth]/route.ts` | NextAuth v4 + JWT + Credentials |
| 权限 | `lib/permissions.ts` | 资源 × 操作 × 角色矩阵 |
| ORM | `prisma/schema.prisma` | 13 张核心表 + 软删 + Decimal/Timestamptz |
| 业务服务 | `server/services/{customer,contract,project,invoice,payment}.ts` | 5 大主链路 |
| 校验 | `lib/validators/*.ts` | 7 个 Zod schema |
| 事件总线 | `server/events/{bus,channels,dispatcher}.ts` | inbox + 外部通道 |
| 状态机 | 各 service 的 `submit/approve/issue/confirm` 函数 | switch 强制迁移 |
| 统计 | `server/services/statistics.ts` | 总览 / 账龄 / Top / 业绩 |
| 导出 | `lib/excel.ts` | exceljs 流式生成 |
| RLS | `lib/rls.ts`、`prisma/migrations/20260614_init/migration.sql` | DB 层兜底 |
| 通知 | `lib/notify-config.ts` | env 驱动通道开关 |

### 4.2 测试与文档

| 类别 | 文件 |
|---|---|
| 单元 | `tests/permissions.test.ts` |
| E2E | `tests/e2e-flow.mjs`、`tests/p2-flow.mjs`、`tests/p3-flow.mjs` |
| 压测 | `scripts/dev/loadtest.mjs` |
| 运维 | `scripts/prod/backup.sh`、`scripts/prod/audit-cleanup.sh` |
| 文档 | `docs/{CODE_REVIEW,P2_REVIEW,P3_REVIEW,RLS,PROJECT_SUMMARY}.md` |

---

## 五、未来优化方向

### 5.1 短期（1-2 周）— 性能与稳定性

| 项 | 现状 | 优化 |
|---|---|---|
| **Prisma 连接池** | 默认（5 连接） | `?pgbouncer=true&connection_limit=20` |
| **生产压测** | 仅 dev 模式数据 | `next build` + `next start` + 同硬件复测 |
| **SWR 客户端缓存** | 列表每次 fetch | 客户 / 合同 / 项目列表加 `revalidate: 30s` |
| **N+1 查询** | 部分 list 接口 | Prisma `include` + 投影指定字段 |
| **慢 SQL 日志** | 无 | Prisma `query` event → pino |
| **错误监控** | console.warn | Sentry / Datadog（捕获 ApiError 上下文） |

### 5.2 中期（1-2 月）— 安全与可观测

| 项 | 现状 | 优化 |
|---|---|---|
| **RLS 全面启用** | 仅 createCustomer 用 rlsTransaction | 所有 service 的 list / get / update 都包 |
| **审计日志查询 UI** | 仅 admin REST 接口 | `/admin/operation-logs` 页面 + 时间范围 + 实体筛选 |
| **登录限流** | 无 | 3 次失败 15 分钟锁（设计文档 §13 已提，未实现） |
| **图形验证码** | 无 | login 页加 `svg-captcha` |
| **SSO 接入** | 占位 | 企业微信扫码登录（OAuth 2.0） |
| **OpenAPI 文档** | 无 | zod-to-openapi + Swagger UI |
| **数据脱敏** | 部分 | 列表接口金额 / 邮箱按角色脱敏（设计文档 §3 OPS 隐藏金额） |

### 5.3 长期（季度级）— 架构演进

| 项 | 现状 | 优化 |
|---|---|---|
| **事件总线** | 进程内 | Redis Streams / Kafka（多实例可消费） |
| **任务调度** | Vercel Cron / 本地 shell | Temporal / BullMQ（幂等 + 重试 + 死信） |
| **前端 SSR 缓存** | 无 | `unstable_cache` + tag 失效（合同详情 60s） |
| **附件存储** | URL 字符串 | S3 / OSS + 预签名 URL + 病毒扫描 |
| **API 网关** | 直接打 Next.js Route Handler | Kong / APISIX（限流 / 鉴权 / 监控） |
| **多租户** | 单租户 | 加 `tenantId` 字段 + RLS 兜底（已有 RLS 经验可复用） |
| **移动端** | 仅 Web 响应式 | 独立 H5（保留 antd-mobile 升级路径） |
| **BI 报表** | 当前总览 / 账龄 | Metabase / Superset 嵌入（自建数据仓库） |
| **AI 辅助** | 无 | 客户跟进记录 → 自动生成下次跟进建议 |

### 5.4 工程化

| 项 | 优化 |
|---|---|
| **CI/CD** | GitHub Actions：`typecheck + vitest + e2e` 三件套 → Vercel preview → main 自动部署 |
| **代码规范** | ESLint + Prettier + lint-staged + husky pre-commit |
| **依赖管理** | Renovate 自动 PR（注意 antd 子依赖 overrides） |
| **Changelog** | release-it + Conventional Commits |
| **Storybook** | pro-extensions 组件库化（EditableTable / ImportButton / ExportButton） |
| **可视化测试** | Playwright `expect.toHaveScreenshot()`（关键页面防回归） |

### 5.5 数据治理

| 项 | 优化 |
|---|---|
| **数据字典** | 维护 `Dictionary` 表，UI 自动渲染下拉 |
| **业务编号规则** | 现状 QT-{类型简码}-YYYY-#### 4 位；高并发时可改 Sequence 预分配 |
| **金额精度** | `@db.Decimal(18,2)` 现 OK；做乘法时 `Decimal.js` 兜底 |
| **时区** | 数据库 timestamptz OK；前端 dayjs + `Asia/Shanghai` 默认 |
| **历史归档** | 5 年以上合同 / 客户归档到 `*_archive` 表，保留查询不保留写 |

### 5.6 团队与流程

| 项 | 优化 |
|---|---|
| **领域模型 review** | 5 状态机 + 16 校验规则每季度 review 一次 |
| **错误码字典** | 维护 `types/errors.ts` 文档化（含义 / 触发 / 解决方案） |
| **运维 Runbook** | 备份恢复 / 故障切换 / 性能瓶颈排查 |
| **权限审计** | 每季度 review 一次角色 × 资源矩阵 |

---

## 六、给后续开发者的建议

### 6.1 入门 5 步

1. **读 `docs/` 4 份 review** + 设计文档 v3
2. **看 `prisma/schema.prisma`** 理解 13 张表关系
3. **看 `server/services/customer.ts`** 作为 service 范例（含 RLS 包装）
4. **跑 `tests/e2e-flow.mjs`** 理解业务流程
5. **写一个新模块**：先 schema → validator → service → route → page → e2e

### 6.2 改代码前必看

- `types/errors.ts` 错误码字典
- `lib/permissions.ts` 权限矩阵
- `server/events/bus.ts` 事件清单
- `prisma/migrations/` 历史迁移（避免重复或冲突）

### 6.3 常见陷阱

| 陷阱 | 防范 |
|---|---|
| 在 Route Handler 里直接写业务逻辑 | 必须走 service 层 |
| 用 `prisma.x.findMany` 不带 `where: ownershipWhere(user)` | 用 helper 包装 |
| 在 service 抛 `throw new Error("xxx")` | 用 `ApiError(ERROR_CODES.XXX, "msg", status)` |
| 用 `JSON.parse(requestBody)` | 用 Zod `schema.parse(await req.json())` |
| 写完代码不跑 `tsc --noEmit` | pre-commit hook 强制 |
| 改 Prisma schema 不写 migration | `prisma migrate dev --name xxx` |
| 部署到生产不跑 P3 E2E | CI 强制 76/76 通过 |

---

## 七、致谢

- 设计文档 v3 是项目最值钱的资产
- 76/76 测试是项目最值钱的保险
- 防御纵深（应用层 + DB 层 RLS）是项目最值钱的护城河
- **业务规则文档化 + 错误码体系 + 状态机事务化** 是 B 端开发的三件套

> **写代码容易，写对代码难；上线容易，可观测难；功能完成容易，长期可维护难。**
> 这个项目在三者之间取得了平衡，但远未到完美。
> 后续 6 个月的迭代重点：**性能压测、SSO、可观测、多租户**。

