# 杭州企泰安全科技 业务管理系统 (qt-biz)

> 客户 / 合同 / 开票 / 回款 一体化管理,附件走 MinIO presigned 直传。
> **当前版本: v0.4.0**(2026-06-28)
> 详细设计见 [docs/DESIGN-v3.md](docs/DESIGN-v3.md),用户手册见 [docs/USER_MANUAL.md](docs/USER_MANUAL.md)。

## 目录

- [技术栈](#技术栈)
- [快速启动](#快速启动)
- [项目结构](#项目结构)
- [业务模块](#业务模块)
- [数据模型与状态机](#数据模型与状态机)
- [跨模块校验规则](#跨模块校验规则)
- [认证 & 权限](#认证--权限)
- [附件存储 (MinIO)](#附件存储-minio)
- [消息与通知](#消息与通知)
- [定时任务](#定时任务)
- [统计分析](#统计分析)
- [移动端适配](#移动端适配)
- [脚本速查](#脚本速查)
- [质量基线](#质量基线)
- [最近更新](#最近更新)
- [历史里程碑](#历史里程碑)
- [部署](#部署)
- [相关文档](#相关文档)

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js (App Router + RSC + Server Actions) | 16.2.7 |
| 运行时 | React | 19.2.7 |
| 语言 | TypeScript (`strict` + `noUncheckedIndexedAccess`) | 6.0.3 |
| UI | Ant Design + @ant-design/pro-components (beta) | 6.4.3 / 3.1.12-0 |
| 图表 | @ant-design/charts | 2.6.7 |
| 状态 | zustand | 5.0.14 |
| 数据请求 | swr | 2.4.1 |
| 校验 | zod | 4.4.3 |
| ORM | Prisma + @prisma/adapter-pg | 7.8.0 |
| 数据库 | PostgreSQL | 16 |
| 对象存储 | MinIO + @aws-sdk/client-s3 v3 | latest |
| 认证 | NextAuth (Credentials + JWT) | 4.24.14 |
| 加密 | bcrypt | 6.0.0 |
| 测试 | Vitest + @playwright/test | 4.1.8 / 1.60.0 |

完整版本矩阵与兼容性说明见 [docs/DESIGN-v3.md §1](docs/DESIGN-v3.md)。

## 快速启动

需要 Node `>=20.9.0`,Docker(本地起 Postgres + MinIO)。

```bash
# 一键全流程:起 PG + MinIO + 装依赖 + 推库 + seed + 起 dev server
# (默认还会 seed 4 个 dev 测试账号 + 100 个 dev 客户;前台进程,Ctrl-C 退出)
npm run dev:setup
```

如需手动分步(生产部署 / 自定义 seed):

```bash
# 1) 起基础设施
docker compose -f docker-compose.postgres.yml up -d
docker compose -f docker-compose.minio.yml up -d

# 2) 配环境变量
cp .env.example .env   # 默认 minioadmin/minioadmin, qitai/qitai_pass

# 3) 装依赖 + 推库
npm install
npx prisma migrate dev

# 4) 系统管理数据
npm run seed           # 5 角色 / 5 部门 / 8 类字典
npm run seed:dev-users # 可选: 4 个 dev 测试账号

# 5) 创建第一个业务管理员
npm run create-admin -- \
  --employeeNo admin \
  --name "系统管理员" \
  --email admin@example.com \
  --password 'Your-Strong-Pwd-2026'

# 6) 起服务
npm run dev            # http://localhost:3000
```

### 测试账号(dev 快速填充卡)

登录页右下角"测试账号"卡列出 4 个角色账号;`seed:dev-users` 还会建 `expert` 共 5 个,密码统一从 `DEV_QUICK_FILL_PASSWORD`(默认 `dev-only-fill`)读,只供 dev/test 用。

```bash
npm run seed:dev-users
```

## 项目结构

```
app/                       Next.js App Router(页面 + Route Handlers)
  (app)/                   已登录布局 (Sider + Header + Content)
    dashboard/             工作台
    customers/             客户管理
    contracts/             合同管理
    invoices/              开票管理
    payments/              回款管理
    statistics/            统计分析(总览/账龄/业绩/Top)
    admin/                 系统管理(用户/角色/部门/字典/审计)
    messages/              消息中心
    announcements/         公告
  api/                     Route Handlers(见下)
  login/                   登录页
components/                共享 UI(admin/customers/file/form/...)
lib/                       客户端逻辑(auth/permissions/validators/i18n/...)
server/                    后端服务层(services/events/jobs/storage/audit)
prisma/                    schema.prisma + seed + migrations/
tests/                     Vitest(unit + api) + Playwright(e2e)
docs/                      设计 / 评审 / 手册 / 部署
ops/                       运维脚本
scripts/                   dev/prod/migrate/shared CLI
docker-compose.postgres.yml
docker-compose.minio.yml
```

### 路由一览

- `app/api/auth/` — NextAuth
- `app/api/{customers,contracts,invoices,payments}/` — 五大业务 CRUD
- `app/api/files/` — 附件 presigned URL
- `app/api/messages/` — 站内信
- `app/api/announcements/` — 公告
- `app/api/dashboard/` — 工作台汇总
- `app/api/statistics/` — 统计分析
- `app/api/{users,roles,departments,dictionaries,admin}/` — 系统管理
  - 员工档案(v0.4+)走 5 步向导 + 5 张子表(教育/工作/证书/技能/紧急联系人);证书 30/15/7 天到期 cron 提醒;详情页 Anchor 滚动
- `app/api/operation-logs/` — 操作日志
- `app/api/jobs/` — 定时任务触发端点

## 业务模块

### 五大业务模块

| 模块 | 状态机 | 关键文件 |
|---|---|---|
| 客户 (Customer) | LEAD / NEGOTIATING / SIGNED / LOST / FROZEN (5 态 + 自动联动) | `server/services/customer/{crud,status,automation}.ts` |
| 合同 (Contract) | DRAFT / ACTIVE / CLOSED (3 态 + 自动转换) | `server/services/contract/{crud,status}.ts` |
| 开票 (Invoice) | DRAFT / PENDING_FINANCE / ISSUED / REJECTED / VOIDED / RED_FLUSHED | `server/services/invoice.ts` |
| 回款 (Payment) | PLANNED / CONFIRMED / RECONCILED / REFUNDED / CANCELLED | `server/services/payment.ts` |

### 支撑模块

- **消息中心** — `server/services/message.ts` + `server/events/bus.ts`,事件→站内信
- **公告** — `server/services/announcement.ts`
- **统计分析** — 总览/账龄/业绩/Top 客户,xlsx 导出
- **操作日志** — `server/audit.ts` + `lib/request-context.ts` 自动注入 IP/UA/requestId
- **定时任务** — 5 个 cron,统一走 `/api/jobs/run-all`
- **软删除** — `deletedAt` + 30s TTL 缓存,统一走 `server/services/trash.ts`

## 数据模型与状态机

Prisma schema 见 [prisma/schema.prisma](prisma/schema.prisma),完整状态机迁移与迁移 SQL 见 `prisma/migrations/`。

### Contract 状态机(7 → 3 收敛)

```
DRAFT ──(字段完整 + 附件)──> ACTIVE ──(开票足额 R-07)──> CLOSED
                                  └─(endDate < now)────> CLOSED (reason=expired)
```

自动转换:`tryAutoPublish`(DRAFT → ACTIVE) / `tryAutoComplete`(ACTIVE → CLOSED,开票足额) / `tryAutoExpire`(endDate 到期)。actor 统一为 `system` 占位用户(`User.isSystem=true`,不可登录)。

### Invoice 状态机(6 态)

```
DRAFT ──submit──> PENDING_FINANCE ──issue──> ISSUED
                                              ├─> VOIDED (作废)
                                              └─> RED_FLUSHED (红冲)
```

### Payment 状态机(5 态)

```
PLANNED ──confirm──> CONFIRMED ──reconcile──> RECONCILED
                  ├─> REFUNDED (退款)
                  └─> CANCELLED (取消)
```


## 跨模块校验规则

| 规则 | 含义 | 校验点 | 错误码 |
|---|---|---|---|
| R-01 | 客户统一社会信用代码 GB 32100-2015 | Zod refine | 400 |
| R-07 | 合同 ACTIVE → CLOSED 需开票足额 | service 事务 | – |
| R-08 | 累计开票 ≤ 合同总额 | service 事务 | 422 INVOICE_OVER_LIMIT |
| R-09 | 发票 ISSUED 需抬头 + 税号 | service 事务 | 422 INVOICE_INFO_INVALID |
| R-10 | 回款 bankRefNo CONFIRMED 唯一 | service 事务 | 409 PAYMENT_DUPLICATE_REF |
| R-11 | 发票级回款不超额 | service 事务 | 422 PAYMENT_OVER_INVOICE |
| R-12 | 合同级回款不超额 | service 事务 | 422 PAYMENT_OVER_CONTRACT |
| – | SALES 行级隔离 | ownershipWhere 注入 | 404 |

完整规则与边界场景见 [docs/DESIGN-v3.md §6](docs/DESIGN-v3.md)。

## 认证 & 权限

NextAuth v4 + JWT 策略(不挂 PrismaAdapter,P0 阶段简化)。

### 「7 天内自动登录」

- 登录页勾选复选框 → JWT 寿命 7 天;不勾选 → 8 小时
- 实现:`lib/auth.ts` 自定义 `authOptions.jwt.encode` 拦截 `maxAge`
- e2e 验证:`tests/e2e/auto-login.spec.ts` 用 `jose.jwtDecrypt` + 32 字节 HKDF 解密 JWE 断言 `exp - iat`

### 5 角色 RBAC

| 角色 | 用途 | 权限位 |
|---|---|---|
| ADMIN | 全部操作 + 系统管理 | 全量 |
| SALES | 业务执行,行级隔离 | 业务模块 R/W,只读自己 owner 的数据 |
| FINANCE | 开票/回款 | 开票/回款 R/W,其余只读 |
| OPS | 部门/字典维护 | 系统管理 R/W,业务只读 |
| EXPERT | 专家角色(权限测试) | 最小权限 |

权限位定义在 `lib/permissions.ts`,与 `prisma/seed.ts` 同源。SALES 行级隔离依靠 `ownershipWhere(user)` 注入 Prisma 查询 `where` 子句。

### Cookie & 会话

- 生产 `useSecureCookies` 仅在 `FORCE_HTTPS=true` 时开启(HTTP 反代下保持非 secure)
- 密码 bcrypt cost=10 哈希
- 角色 / 状态 30s TTL 缓存,admin 改角色 / 禁用户最迟 30s 生效

## 附件存储 (MinIO)

附件上传走 presigned PUT 直传,不经过应用服务器。

**启动**

```bash
docker compose -f docker-compose.minio.yml up -d
# Console: http://localhost:9001  账号 minioadmin / minioadmin
# S3 API:  http://localhost:9000
```

`qitai-minio-init` 容器在主服务 healthy 后自动建桶 `qt-biz-attachments`(私有)。

**关键流程**

1. 前端 `ProFormUploadButton` 的 `customRequest` 调 `POST /api/files/presign-upload` 拿 5min 有效 PUT URL
2. 浏览器 `fetch(url, { method: "PUT", body: file })` 直传 MinIO
3. 详情页点文件名 → `POST /api/files/[id]/presign-download` 拿 5min GET URL → 新标签打开

**业务规则**

- MIME 白名单:PDF / Word / Excel / JPEG / PNG / WebP
- 单文件 ≤ 20MB,单合同附件 ≤ 5
- `objectKey` 命名:`contracts/{yyyy}/{mm}/{cuid}-{slug}.{ext}`
- 下载鉴权:复用 `requireSession()` + 合同 `read` 权限
- 软删除:删 `Attachment` 记录但保留 MinIO 对象

**关键文件**

| 文件 | 职责 |
|---|---|
| `server/storage/minio.ts` | S3Client 单例 + ensureBucket + CORS |
| `server/storage/presign.ts` | `presignUpload` / `presignDownload` |
| `app/api/files/presign-upload/route.ts` | 拿 PUT URL |
| `app/api/files/[id]/presign-download/route.ts` | 拿 GET URL |
| `app/api/files/[id]/route.ts` | 软删除 |
| `lib/upload-client.ts` | 浏览器 `customRequest` 上传封装 |

## 消息与通知

通知统一走站内信（顶栏铃铛 + `/messages`）。邮件 / 企业微信通道已下线，运维侧不再需要 SMTP 或 webhook 凭据。

**领域事件触发矩阵**(`server/events/bus.ts`)

| 事件 | 触发时机 | 接收人 |
|---|---|---|
| CONTRACT_PENDING_REVIEW | 合同 submit | 全部 ADMIN |
| CONTRACT_APPROVED | 合同 approve | contract.ownerUserId |
| CONTRACT_REJECTED | 合同 reject | contract.ownerUserId |
| PAYMENT_RECEIVED | 回款 confirm | owner + 全部 ADMIN |
| INVOICE_OVERDUE_PAYMENT | 定时任务(issue + 30 天) | owner + admin + finance |
| CONTRACT_EXPIRING | 定时任务(endDate - 30/7/1) | owner + admin |
| CONTRACT_AUTO_EXECUTED | 项目 start 触发 | owner + 全部 ADMIN |
| CONTRACT_AUTO_COMPLETED | 合同下所有项目收尾 | owner + 全部 ADMIN |
| CONTRACT_AUTO_EXPIRED | 定时任务(endDate < now) | owner + 全部 ADMIN |

## 定时任务

5 个 cron job,统一通过 `/api/jobs/run-all` 触发。

```bash
# 管理员手动触发(生产环境需 Authorization: Bearer $CRON_SECRET)
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/run-all

# 单跑
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiring
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/invoice-overdue
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiry
```

生产建议 Vercel Cron 每小时触发一次 `/api/jobs/run-all`:

```json
{
  "crons": [{ "path": "/api/jobs/run-all", "schedule": "0 * * * *" }]
}
```

`runAllJobs` 预取 admin 列表一次,所有 job 复用(N+1 → 1)。生产环境强制 `CRON_SECRET`,缺失时 500 告警并拒绝执行。

## 统计分析

```bash
GET /api/dashboard/summary                          # 工作台 4 卡片 + 账龄
GET /api/statistics/overview?from&to                # 总览 + 时间序列
GET /api/statistics/invoice-aging                   # 应收账款账龄
GET /api/statistics/top-customers?metric=contract|payment&limit=10
GET /api/statistics/employee-performance?userId=&from=&to=
GET /api/statistics/export?type=overview|top-customers|employee-performance   # xlsx 下载
```

xlsx 导出走 `lib/excel.ts` + `exceljs`,带 BOM 支持中文。

## 移动端适配

断点沿用 Antd 6 默认(`xs=480` / `sm=576` / `md=768` / `lg=992` / `xl=1200`),`md` 作为手机/平板分水岭。

**Shell 行为**

- `>=md` 桌面:左 232px 固定 Sider + 顶部 64px Header
- `<md` 手机:Sider 收起,顶栏左侧汉堡按钮 → 左抽屉 Drawer(`min(320, 85vw)`),带遮罩;路由切换 / 菜单点击 / 遮罩点击自动关闭
- 头像 + 用户名 + 角色在 `<sm` 极窄屏隐藏,只保留头像
- 面包屑在 `<sm` 只显示最后一段

**业务页行为**

- 列表:ProTable 加 `scroll.x: max-content` + sticky 头,移动端搜索栏 `layout: vertical`、分页 `size: small`;首列 `fixed: left` 便于横滑
- 详情:ProDescriptions 改为 `{ xs:1, sm:1, md:2, lg:2, xl:3 }` 列数;内嵌 ProTable 同样加 `scroll.x` + sticky
- 表单:FormGrid 在 `<sm` 强制 1 列,SubmitBar 移动端块状按钮 + 贴底安全区
- 抽屉:`<md` 改 `placement: bottom`、`width: 100%`、`height: 90%`
- 统计:图表 `autoFit` + 高度在 `<md` 压缩到 240px

**触摸与可达性**

- 重要按钮(`size="large"`)在 `<md` 强制 ≥ 40px 命中区
- 主体加 `.qt-touch` class,禁用菜单 hover-to-open
- `:focus-visible` 沿用 Antd 主色键盘焦点环
- 移除 `-webkit-tap-highlight-color`,用 Antd 自带 active 态

**实现要点**

- 单一 hook `lib/use-breakpoint.ts`:薄包装 `antd.Grid.useBreakpoint()`,SSR 安全(首次渲染保守返回桌面)
- 不引入 Tailwind / 额外 UI 库;`globals.css` 新增 `.pt-safe` / `.pb-safe` 等安全区工具类
- 桌面端零回归;手机端列表仍是水平滚动而非卡片流(ProTable 3.1.12-0 beta 的 card 视图 API 暂不稳定)

## 脚本速查

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run dev:setup` | 一键起 Postgres + MinIO + 装依赖 |
| `npm run dev:up` / `dev:down` | 同上,仅 Docker 生命周期 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run typecheck` | TS 类型检查 |
| `npm run lint` / `lint:fix` | ESLint(0 warnings) |
| `npm test` | 单元 + API 测试 (Vitest) |
| `npm run test:e2e` | E2E (Playwright) |
| `npm run prisma:migrate` | 创建/应用 migration |
| `npm run prisma:deploy` | 生产应用 migration |
| `npm run prisma:studio` | Prisma Studio |
| `npm run seed` | 跑系统管理 seed(角色/部门/字典/工作流模板) |
| `npm run seed-roles` | 只插 5 角色 |
| `npm run seed-dicts` | 只插 8 类字典 |
| `npm run create-admin` | CLI 创建账号 |
| `npm run seed:dev-users` | dev 专用,幂等 upsert 5 个测试账号 |
| `npm run reset-password` | 重置密码 |
| `npm run loadtest` | 压测 (默认 50 并发 × 5s) |
| `npm run migrate:legacy[:dry]` | FineUI 旧库迁移 CLI |
| `npm run migrate:contract-status-dict` | 合同状态机迁移(7→3 配套字典) |
| `npm run migrate:customer-district[:dry]` | 客户地区字段离线补全 |

完整 scripts 见 [package.json](package.json)。

## 质量基线(2026-06-28)

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 61 个 .test.ts 文件(539 用例),全绿 |
| `npm run test:e2e` | 11 specs / 全绿 |
| `prisma generate` + `migrate deploy` | 25/25 migrations, client v7.8.0 |
| `npm run build` | 成功 |
| dev server `/login` `/dashboard` `/contracts` | 200 |

## 最近更新

### v0.5.0(2026-06-29)客户状态机下线(硬删)

业务反馈 v0.4.0 上线的客户状态机(5 态 + 4 条自动规则 + 7 天可撤销横幅)语义不清 / 自动化规则常误判, 整体硬下线。设计: [docs/superpowers/specs/2026-06-29-customer-status-deprecation.md](docs/superpowers/specs/2026-06-29-customer-status-deprecation.md)。

- **chore(customer)**:删 `Customer.status / lastAutoAppliedAt / lastAutoRule` 3 列 + `@@index([status])` (`Customer_status_idx`); 删 `enum CustomerStatus`(5 态); migration `20260629_drop_customer_status`(`DROP INDEX IF EXISTS` + `DROP COLUMN IF EXISTS`, idempotent, 状态列 v0.4.0 起为 String 故无需 backfill)
- **chore(lib)**:删 `lib/customer-status-transitions.ts` / `lib/customer-auto-rules.ts`; `lib/{status,dict-domain,dictionary-categories,use-status-enum,validators/customer,env,customer-update}.ts` 移除 `customer` StatusDomain 引用 / 字典 / 校验字段 / 错误码 `CUSTOMER_STATUS_TRANSITION_INVALID` / `CUSTOMER_AUTO_*`
- **chore(server)**:删 `server/services/customer/{status,automation}.ts` + `server/services/customer-status.ts` + `server/jobs/customer-status-suggest.ts`; 改 `server/services/customer/{crud,index}.ts` / `server/services/contract/{crud,status}.ts` / `server/jobs/runner.ts` / `server/events/bus.ts` / `server/services/statistics.ts` 移除外发调用
- **chore(api)**:删 `POST /api/customers/[id]/revert` 路由; 改 `GET/PATCH /api/customers/[id]` / `GET /api/customers/export` / `GET /api/jobs/[job]` / `GET /api/statistics/overview` 移除外发
- **chore(ui)**:删 `components/customers/auto-status-banner.tsx`; 详情页/列表页/表单移除「变更状态」入口 + 撤销横幅; 客户 PDF 改用合同级状态
- **chore(types|events|errors)**:`MessageType` enum 3 个 `CUSTOMER_STATUS_*` 值**保留**(历史消息 fallback); `bus.ts` `default` 分支渲染为「历史消息」; `operation-log-format.ts` `CUSTOMER_STATUS_*` action 返 null
- **refactor(schema)**:跨模块校验 R-02 / R-03 / R-13 删; R-16 指向 `lib/status-machine.ts`(通用抽象, 仍 4 实体共用)
- **chore(tests)**:删 `tests/{api,unit,unit/server}/customer-status*.test.ts` + `tests/e2e/08-customer-status.spec.ts`; 修 5 个 contract-* test + `customers-patch` / `customer-update` / `validators/customer` / `events-bus` / `contract-create-validation` / `customer-contract-overview-ownership` / e2e `05-invoice-payment-flow`
- **chore(docs)**:DESIGN-v3 §5.5 → deprecation 链接; PROJECT_SUMMARY §3.3.2 → 简化为 deprecation 总结; USER_MANUAL §5.1 状态表 / §5.6 客户状态自动联动 / FAQ Q5 全删; README 删 §3 客户状态机节 + 删 R-02/R-13; v0.4.0 spec `2026-06-28-customer-status-automation.md` 移入 `docs/superpowers/specs/_archive/`
- **test**:vitest 425/425(54 files, -14 customer-status 用例); typecheck 0 error; eslint 0 warning; 后续 e2e(跳过 08-customer-status)待 commit 前跑

提交 `BREAKING CHANGE` 一次性合并(单 commit, 涵盖所有 schema/lib/server/api/ui/types/tests/docs 改动)。

### v0.3.1(2026-06-26)员工档案 + 证书到期 cron + 资产下线 + 导航重构

- **feat(employee-profile)**:`EmployeeProfile` 表 + 5 张子表(教育/证书/工作经历/合同/家庭成员),`Attachment.category` 字段,`MessageType.CERTIFICATE_EXPIRING` 枚举值
- **feat(employee-profile)**:PR7-PR11 五批 — 批量操作 + 向导/子表打磨 + E2E 覆盖 + P0 阻塞修复 12 项 + 用户手册 v0.4 重做
- **feat(certificate)**:证书到期 cron 30/15/7 档(`certificate-expiry-check`)+ 列表页 + 用户列表 badge
- **chore(refactor)**:下线公司资产库(CompanyAsset)模块 — DROP CompanyAsset + DROP Attachment.assetId/isPrimary + DROP POLICY + DELETE 字典 ASSET_TAG(资产模块生命周期 13 天)
- **feat(message)**:Message.type 从 text 收紧到 enum MessageType(7 枚举值),加 type+receiverUserId+createdAt 复合索引
- **refactor(nav)**:统一返回按钮走 `useGoBack()` hook(浏览器历史优先 + fallback 兜底),删 30+ 处硬编码 `router.push('/x')`;详情页 5 分组合并为 ProfileHero + 卡片网格
- **fix(nav)**:消息中心 PageHeader 加 type='navigation' 提示
- **fix(lint)**:antd 新 API — `Space direction='vertical'` → `orientation='vertical'`
- **fix(dashboard)**:summary 接口把 range 塞进 overview 返回
- **fix(statistics)**:员工业绩页默认本月区间(与 dashboard 一致)
- **fix(invoice)**:开票保存 applyDate 改用 dayjs().toISOString() 兼容 string/dayjs
- **fix(invoice-new)**:合同下拉 pageSize 100 → 1000
- **fix(contract-export)**:新增项目负责人列,签订人/负责人只显示姓名
- **fix(users)**:详情页删右侧 Anchor 解决 active 不同步;SWR 多解一层;修 DepartmentTreeSelect 集成;加保存按钮;skeleton 永远卡死
- **test(e2e)**:场景 14 - 员工档案 CRUD + 附件上传端到端覆盖
- **chore(test)**:删 `tests/e2e/13-employee-batch-ops.spec.ts`(多选链路已移除)

**部署期观察**:6 个新迁移在 v0.3.0 → v0.3.1 之间手工应用(`20260630_message_type_enum_index` 试 3 次才成功),本次 1 commit `b2e9f1bdf` 是纯 refactor,deploy.sh 一键跑。详见 `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` v0.3.1 节

**已知问题**:`contract-auto-complete` job 偶发 `TransactionWriteConflict`(PostgreSQL 40001,单实例 3.5G 机器无分布式锁,193 行扫描里 1 条失败);job 缺 retry loop,v0.3.2 / v0.4.0 跟进

### v0.3.0(2026-06-24)企业资产库模块下线

> 沿用 `20260623_drop_project_and_workflow` 的硬下线模式:删表 + 删代码 + 删权限 + 删菜单。详见 `prisma/migrations/20260628_drop_company_assets/`、`lib/permissions.ts`、`components/dashboard-shell.tsx`。

- **chore(asset)**:`CompanyAsset` 表 + `Attachment.assetId/isPrimary` 列 DROP,`RESOURCE.ASSET` 与 5 角色 ASSET 权限矩阵回收,`asset-expiring` 定时任务 / `ASSET_EXPIRING` 消息链路拆除
- `app/(app)/assets/`、`app/api/assets/`、`components/assets/`、`server/services/asset{,-stats,-expiry-job}.ts`、`lib/{assets,validators/asset}.ts`、`prisma/seed-assets.ts` 整目录/文件移除
- `ASSET_TYPE` / `ASSET_STATUS` / `ASSET_TYPE_MAP` / `ASSET_STATUS_MAP` / `ASSET_*` 错误码 / `menu.assets` / `asset.*` i18n 全部清掉
- 3 个 `seed:assets` / `migrate:asset-primary-attachments[:dry]` npm script 移除
- `ASSET_TAG` 字典白名单与 seed 同步清掉

### v0.3.0(2026-06-24)统计分析 round-2 收尾

详见 [docs/P2_REVIEW.md](docs/P2_REVIEW.md) 末尾 Round-2 修复节、[docs/DESIGN-v3.md](docs/DESIGN-v3.md) §8 / §9.7、[docs/USER_MANUAL.md](docs/USER_MANUAL.md) §11。

- **chore(statistics)**:round-2 工具与脚本入库 — `lib/date-range.ts` 统一前后端日期范围,`scripts/dev/seed-customers-contracts.ts` dev 测试数据,`scripts/shared/cleanup-minio-objects.ts` MinIO 桶清理
- **test(statistics)**:`tests/api/statistics-aggregation.test.ts` 4 条真实 DB 集成断言(账龄 total / REFUNDED 抵消 / unpaidAmount clamp / SALES short-circuit)
- **fix(statistics)**:修复 `unpaidAmount === 0` 断言(改用 delta 法验证 clamp 行为)
- **chore**:删除 `tests/e2e/99-debug-spacing.spec.ts`(引用已下线的 `/assets/new?type=PERFORMANCE`)

### v0.3.0(2026-06-23)合同 7→3 状态机 + 项目/工作流模块删除

- **chore(workflow)**:彻底删除项目管理和工作流引擎模块 — Project / WorkflowTemplate / WorkflowStage / WorkflowTask / WorkflowTaskInstance 五张表 DROP,5 个 dict 类别 `PROJECT_STATUS` 移除,12 个 dead 路由改 410 Gone,`action` 8→5,清掉 ~50 个 dead 字段/路由/文件
- **refactor(contract)**:合同状态机 7 态 → 3 态(DRAFT / ACTIVE / CLOSED)。SQL 迁移带断言(失败会回滚)+ 备份到 `_Contract_status_simplify_bak`;`migrate:contract-status-dict` 软停用 6 旧 code + upsert 3 新 code。4668 合同一次性收敛(524 ACTIVE / 4109 CLOSED / 35 DRAFT)
- **feat(contract)**:合同自动状态机 — `contract-auto-publish`(DRAFT 字段完整+附件 → ACTIVE)和 `contract-auto-complete`(ACTIVE 开票足额 → CLOSED)两个 cron job 落地
- **feat(customer)**:客户状态机 — 字段 `status` (ACTIVE / INACTIVE / PENDING) + 服务层规则(v0.4.0 升级为 5 态, v0.5.0 整体下线)
- **feat(announcement,message)**:公告详情页 + 消息未读计数 + 事件总线收敛
- **feat(invoice,payment)**:发票/回款详情页用 enum map 显示中文标签
- **feat(jobs)**:加 `/api/jobs/contract-expiry` 单跑端点
- **fix(invoice)**:R-08 累计开票包含 DRAFT,避免超额创建草稿
- **chore(refactor)**:6 月业务收紧 — 删 `Project.budgetAmount` + `PaymentAllocation` + OperationLog 审计字段;6 个 ts-nocheck 全部清退
- **feat(data)**:旧 FineUI MySQL 数据迁移 CLI 落盘

部署期 hotfix(`6c3cd090`):Zod v4 `.partial()` 不允许在含 `.refine()` 的 schema 上 — `lib/validators/announcement.ts` 拆出 `announcementFields` 单点真理;`20260626_invoice_attachments_json` 加 `IF NOT EXISTS` 幂等。

### v0.2.0(2026-06-22)合同/项目收紧 + 业务纯化

> 注:v0.3.0 之后此版本引入的"项目"功能已被删除,以下记录保留作历史参考。

- **feat(contract)**:合同管理新增「负责人」字段,创建/编辑可从员工列表选任意 ACTIVE 员工,默认继承 `customer.ownerUserId`
- **feat(project)**:项目详情页 admin-only 删除按钮(状态门控 `PLANNED / CANCELLED`,级联软删 `WorkflowTaskInstance` + `ProjectProgressLog`)。v0.3.0 后随项目模块整体下线
- **feat(payment)**:回款列表关键字搜索扩到「客户名称」
- **refactor(clean-up)**:项目回归纯业务 —— 移除「项目预算」+「回款分配明细」两个非核心横切功能
- **feat(audit)**:`OperationLog` 补 6 字段 `userAgent / requestId / method / path / status / errorMessage` + 配套索引 + 500 字符 `userAgent` CHECK 约束
- **feat(api)**:`GET /api/operation-logs` 增 6 字段与 `ip(contains) / status` 过滤;新增详情接口 `GET /api/operation-logs/[id]` 含 entity 名称 best-effort 反查
- **feat(ui)**:`/admin/operation-logs` 重写 — 状态 / IP 列、6 档快速时间区间、系统用户紫色徽标、动作中文标签、CSV 导出(带 BOM),行点击打开抽屉
- **feat(contract)**:合同状态机自动转换落地 — `tryAutoExecuteContract` / `tryAutoCompleteContract` / `tryAutoExpireContract` 三个钩子 + `runContractExpiryJob` 每日 01:00 扫过期合同
- **feat(schema)**:`User.isSystem Boolean @default(false)` + 迁移创建 `system` 占位用户(不可登录)

## 历史里程碑

- **v0.5.0(2026-06-29)**:客户状态机下线(硬删, BREAKING; 5 态/4 规则/撤销横幅 全删; Customer 表无 status)
- **v0.3.0(2026-06-23/24)**:企业资产库下线 + 统计分析 round-2 收尾 + 合同 7→3 状态机 + 项目/工作流模块删除
- **v0.2.0(2026-06-22)**:合同/项目收紧 + 业务纯化
- **v0.1.0(2026-06-11)**:上线前清理 — 清空 136 个 lint warnings,登录页 + 顶部导航品牌化,统一仓库 `core.autocrlf=false`
- **v0.1.0-rc.1**:MinIO 接入(presign upload/download + Attachment 表 + CORS);Docker 合并为单 image;合同/发票上传/预览/下载/删除端到端打通
- **P3**:RLS 策略 + 备份脚本 + Vercel Cron(原通知三通道已合并到站内信)
- **P2**:领域事件总线 + 4 个定时任务 + 统计分析 + xlsx 导出 + 软删除
- **P1**:五大模块 CRUD + 16 条跨模块校验 + 27/27 e2e
- **P0**:项目脚手架 + 登录 + 字典种子 + 4 角色权限

## 部署

### 环境变量

```env
DATABASE_URL="postgresql://qitai:qitai_pass@localhost:5432/qt_biz?schema=public"
NEXTAUTH_SECRET="..."          # 至少 32 字符
NEXTAUTH_URL="https://app.example.com"
APP_ENC_KEY_HEX="..."          # 32 字节 hex = 64 字符(AES-256-GCM 加密敏感字段)
APP_PUBLIC_URL="https://app.example.com"
APP_LOCALE="zh-CN"
CRON_SECRET="..."              # Vercel Cron 鉴权
FORCE_HTTPS="true"             # 生产开启 Secure Cookie
```

详见 [.env.example](.env.example)。

### 生产部署顺序

```bash
npx prisma migrate deploy
npm run seed-roles
npm run seed-dicts
npm run create-admin -- --employeeNo <真实工号> --name <真名> --email <公司邮箱> --password '<强密码>'
npm run seed       # 此时找到 ADMIN, 写入工作流模板
```

**生产密码**:`create-admin` 强制 ≥ 8 字符,生产请用密码管理器生成的随机串。

### 阿里云 ECS 单主机部署

详见 [docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md](docs/%E9%98%BF%E9%87%8C%E4%BA%91%20ECS%20%E5%8D%95%E4%B8%BB%E6%9C%BA%E9%83%A8%E7%BD%B2%E6%96%B9%E6%A1%88%20%E2%80%94%20qt-biz%20v0.1.0.md) 和 [ops/](ops/)。

### 备份与定时任务

- **本地 cron**:`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**:`vercel.json` 已配 `POST /api/jobs/run-all` 每日 01:00 UTC
- **Cron Secret**:Vercel Cron 自动注入 `Authorization: Bearer <CRON_SECRET>` 鉴权

## 相关文档

| 文档 | 用途 |
|---|---|
| [docs/DESIGN-v3.md](docs/DESIGN-v3.md) | 完整设计(v3,版本矩阵钉版) |
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | 用户手册(对应 v0.2.0,v0.3.0 项目模块已下线) |
| [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) | 项目总结 |
| [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) | 上线前代码审查 |
| [docs/P2_REVIEW.md](docs/P2_REVIEW.md) | P2 评审 + 统计分析 round-2 修复 |
| [docs/P3_REVIEW.md](docs/P3_REVIEW.md) | P3 评审 |
| [docs/RLS.md](docs/RLS.md) | RLS 策略 |
| [docs/PLAYWRIGHT_E2E_REPORT.md](docs/PLAYWRIGHT_E2E_REPORT.md) | Playwright E2E 报告 |
| [docs/ops/字典维护说明.md](docs/ops/%E5%AD%97%E5%85%B8%E7%BB%B4%E6%8A%A4%E8%AF%B4%E6%98%8E.md) | 数据字典维护 |
| [docs/specs/dict-redesign.md](docs/specs/dict-redesign.md) | 字典重设计 spec |
| [ops/README.md](ops/README.md) | 运维脚本说明 |
| [scripts/README.md](scripts/README.md) | 脚本说明 |

## 安全

- **不要**提交 `.env`、`docker-data/`、`backups/`、`docs/*部署记录*.md`
- 上传/下载走 Next.js 代理,MinIO 留在 `:9000` 内网,不公网暴露
- `npm run seed` 仅系统管理数据;生产种子在干净环境手动跑,不随例行更新跑
- dev 默认账号(`minioadmin/minioadmin`、`postgres/postgres`)仅本地用,生产前必须轮换
