# 杭州企泰安全科技 业务管理系统 (qt-biz)

> 客户 / 合同 / 开票 / 回款 一体化管理,附件走 MinIO presigned 直传。
> **当前版本: v0.9.7**(2026-07-08)
> 详细设计见 [docs/DESIGN-v3.md](docs/DESIGN-v3.md),用户手册见 [docs/USER_MANUAL.md](docs/USER_MANUAL.md)。
> 2026-07-04 增量同步: 全库代码审计 10 处 bug 修复 + 2 组单元测试已补到「最近更新」开头。

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

xlsx 导出走 `lib/excel.ts` + `exceljs`; 中文文件名通过 `attachmentHeader()` 走 RFC 5987 双形式(`filename=` ASCII 兜底 + `filename*=UTF-8''...`)。

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

## 质量基线(2026-07-03, v0.8.0)

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 65 个 .test.ts 文件 (547 用例), 全绿 (4 个 pre-existing failures 与本次改动无关) |
| `npm run test:e2e` | 11 specs / 全绿 |
| `prisma generate` + `migrate deploy` | 28/28 migrations, client v7.8.0 |
| `npm run build` | 成功 |
| dev server `/login` `/dashboard` `/contracts` `/reports/PERFORMANCE` | 200 |

## 最近更新

### v0.9.7(2026-07-08) 日期与日期时间显示/导出统一为 YYYY-MM-DD 风格

> 此前 `lib/format.ts` 的 `formatDate`/`formatDateTime` 依赖 `zh-CN` locale,输出 `2026/06/09` 与 `2026/06/09 17:30`;
> 同时全库散落 18 处裸 `new Date(x).toLocaleDateString('zh-CN')` / `toLocaleString('zh-CN')`,与中央函数行为分裂。
> 本次把中央函数切到本地时区的 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm`,所有调用点统一走中央 helper。

**中央函数改造** (`lib/format.ts`):
- 新增 `formatYmd(d)` / `formatHm(d)` 两个内部工具,纯本地时区拼接,无 locale 依赖
- `formatDate` → `YYYY-MM-DD`,`formatDateTime` → `YYYY-MM-DD HH:mm`,空值仍返回 `-`

**18 处调用点统一**:
- 显示/页面 (8): `components/release-popup`、`components/admin/operation-log-drawer`、`components/dashboard-shell`、`app/(app)/admin/{operation-logs,trash,users}/page.tsx`、`app/(app)/admin/users/page.tsx` (CSV 导出)、`app/(app)/announcements/page.tsx`、`app/(app)/payments/[id]/page.tsx`
- 导出/CSV (5): `app/api/{contracts,customers,invoices,payments}/export/route.ts` + 上述 users 导出 — 空值回退保留为 `""`
- PDF 路由 (4): `app/api/{contracts,customers,invoices,payments}/[id]/pdf/route.ts` + `lib/print-html.ts` — 空值回退保留为 `"—"`
- 统计 PDF (1): `app/api/statistics/employee-performance/pdf/route.ts` — 空值回退保留为 `"-"`

**保留不动**:
- `server/events/bus.ts` 本地 `formatDate` 本就 `toISOString().slice(0,10)`,已是 `YYYY-MM-DD`
- `scripts/migrate/{contract-fake-close-recovery,contract-fake-close-recurrent-lock}.ts` 本地 `formatDate` 用于 SQL 表名 `YYYYMMDD`,非用户可见

**版本号**: `0.9.6` → `0.9.7`(patch bump,纯 UI 文案统一,无 schema 变更,无 API 契约变更,无 breaking)

**部署说明**:
- 无 schema 变更、无新 migration,`prisma migrate deploy` 不需要跑
- 重启 next start 即可生效(无缓存文件、无服务端状态依赖)
- 导出 CSV/Excel 列宽可按需调整(日期字段从 14 → 10 字符宽度更紧凑)

### v0.8.2(2026-07-04) 回滚 9a48265 + README 乱码修复 + 删 CI/Deploy 自动化

> `9a48265` 那次 commit 引入 3 个 prisma migration 试图下线报表中心,但在 fresh DB 上按时间序 apply 时与历史 migration `20260707_report_center` 冲突(同一 `ReportDefinition` 表被两次 CREATE 字段结构不同的版本),CI 在 `prisma drift` 和 `vitest` 两个 job 的 `prisma migrate deploy` 步骤上失败。本版本决定回滚该 commit 的代码 + migration 改动,保留 v0.8.1 状态;同时彻底删除 CI 和 GitHub 自动部署(workflow 文件 + 依赖),改回「本地开发 + 运维手动部署」模式。

**回滚 9a48265 (一)**:
- 原因: `9a48265` 的 3 条 migration(`20260704_report_center_redesign` / `20260704_report_ready_message_type` / `20260709_drop_report_center`)在 fresh DB 上跑会撞上历史 `20260707_report_center` (e543c41) 已经创建的 `ReportDefinition` / `ReportSnapshot` 表,CI 红
- 范围: 19 个代码/lib/test/seed 文件 + 3 个 migration 目录全部回退到 `ced7665` (9a48265 父) 状态
- 保留: `app/(app)/reports/*` 页面、`server/services/report.ts` 报表 service、`lib/report-labels.ts` 标签字典等全部复活
- 后续: 报表中心下线需用单一 migration(不带中间临时状态)重做,跟 `20260707_report_center` 复用同一组表结构,**不能再独立 CREATE TABLE ReportDefinition**

**README 乱码修复 (二)**:
- 根因: `9a48265` commit 提交时,`README.md` 被以错误编码写入 git blob(8200+ 简体汉字保存为 UTF-8 mojibake 形态,UTF-8 严格解码虽然通过但语义全部变成繁体/日文汉字)
- 修复: 从 `185b9c7` (v0.8.1) 还原 blob 后,**追加** v0.8.2 changelog 段(本节)
- 影响: `185b9c7` 之后的 README 历史 blame 在 v0.8.2 这条 commit 处归位,后续 commit 仍能正常追溯

**删 CI / GitHub 自动部署 (三)**:
- 移除: `.github/workflows/ci.yml` (-193 行) + `.github/workflows/deploy.yml` (-26 行),共 -219 行
- 根因: CI 流程的 `prisma deploy` fallback 自身有 bug(在 9a48265 之前/之后都失败),叠加 v0.8.2 schema migration 冲突,导致 CI 持续红灯 + 自动部署反复挂掉,生产环境被推到不一致状态
- 替代方案: 改回**本地开发 + 运维手动部署**模式,`scripts/prod/deploy.sh` 仍保留(加入 enum fallback 兜底,跟原 CI fallback 行为一致),生产部署由运维 SSH 上去手动 `sudo -E ./scripts/prod/deploy.sh`
- 后续: `next.config.mjs#computeAppVersion()` 仍能在 dev 上正常派生版本号 chip(依赖本地 `.git`),登录页右上角显示不变

**保留: `scripts/prod/deploy.sh` 加 enum fallback**:
- 修了 `20260630_message_type_enum_index` vs `20260627_message_type_enum_bootstrap` 的 enum 冲突,逻辑跟原 CI fallback 一致
- 走 fallback 时用 admin `DATABASE_URL` (qt_app, BYPASSRLS) 跑 `ALTER TYPE`,因为 `MIGRATION_DATABASE_URL` 是降权账号

**版本号**: `0.8.1` -> `0.8.2`(patch bump,仅文档 + 回滚 + 删 CI,无新增功能,无 schema 变更,无应用层 breaking 变更)
**部署说明**:
- 无 schema 变更、无新 migration
- `prisma migrate deploy` 不需要跑(生产 DB 仍在 v0.8.1 之前的 38 条 migration 状态)
- 如果生产已经按 `9a48265` 部署过(可能有 3 条新 migration 记录),需要手动 `migrate resolve --rolled-back` 这 3 条记录(DB 不会有真实 schema 污染,因为 v0.7 报表中心表早已存在,9a48265 的下线 migration 是 `DROP IF EXISTS` 兜底,不影响生产)
- 删 CI 后,**生产部署改回运维手动 SSH + `sudo -E ./scripts/prod/deploy.sh`**;deploy.sh 内的 enum fallback 会自动处理已知冲突
## 502 Bad Gateway 友好页

nginx 反代架构 (`nginx :80` → `next start :3000`) 下, 上游应用重启 / 崩溃 / 内部 5xx 时, 用户看到的不再是 nginx 默认英文 502 页面, 而是以下两层友好回退:

- **`public/502.html` (静态, 3.3 KB)**: nginx `error_page 502 504 = @qt_biz_502_static` 直接 serve, **不依赖 next start**。当应用整体挂掉时仍能看到友好页。
- **`app/502/page.tsx` (Next.js 路由, antd `Result` + `Page` 组件)**: nginx `error_page 500 501 503 = @qt_biz_502_next` 反代到这里, 用于「next start 活着但应用层抛 5xx」的场景 (例如 DB 暂时不可用)。支持 `?from=...` `?retryAfter=...` query 参数。
- **`ops/nginx/qt-biz.conf`**: 完整 nginx server block, 含 upstream / 502/504 静态 fallback / 500/503 Next.js 反代 fallback / healthz 端点 / 静态资源缓存策略。运维 `cp` 到 `/etc/nginx/conf.d/` 后 `nginx -t && systemctl reload nginx` 即可。

启用步骤见 `ops/nginx/qt-biz.conf` 顶部注释。

### v0.8.1(2026-07-04) 代码审计修复: 状态机并发安全 + 金额不变式 + 客户端竞态防护

> v0.8.0 报表中心上线后,对全项目做了一次代码审计,修复 10 个高优先级 bug,补充 2 组单元测试。本次覆盖 11 个文件,0 个新迁移,0 个 API 契约变更。

**状态机并发安全 (一)** (`lib/status-machine.ts`):
- `runTransitionInTx` 的 `UPDATE` 现在把源状态写进 `WHERE` (`status: { in: allowedSourceStatuses }`), 防止并发读-改-写覆盖
- 并发导致 Prisma `P2025` (无行匹配) 时,`silentSkip=true` 返回 `SKIPPED`,否则抛出 `ENTITY_IMMUTABLE` 或自定义 `mismatchError`
- 新增 `tests/unit/lib/status-machine.test.ts` 8 个单测覆盖 WHERE 子句 / P2025 映射 / 非 P2025 传播 / `SkipTransition` 行为

**合同金额不变式 (二)** (`server/services/contract/crud.ts`):
- `ADMIN` 调小 `totalAmount` 时,事务内聚合该合同下 `DRAFT/ISSUED/RED_FLUSHED` 发票金额与 `CONFIRMED/RECONCILED` 回款金额
- 任一聚合值超过新总额 + 0.01 元容差,抛 `INVOICE_OVER_LIMIT` / `PAYMENT_OVER_CONTRACT` (422)
- 新增 `tests/unit/server/contract-update-amount-guard.test.ts` 7 个单测覆盖允许/拦截/容差边界

**金额精度 (三)**:
- `server/services/contract/status.ts`: `tryAutoClose` / `tryAutoCloseOnOverdue` 阈值计算改用 `Prisma.Decimal`,避免 `total * ratio` 浮点漂移
- `server/services/invoice/action.ts`: 红冲创建负数发票时使用 `new Prisma.Decimal(...).negated()` 替代 `-Number(...)`;`PLANNED` 回款 `paymentNo` 改为 `nextBusinessNo("PAYMENT")-PLANNED`,避免时间戳冲突

**客户端竞态防护 (四)**:
- `lib/use-list-request.ts`: 加 `requestIdRef` 序号, 忽略过期请求的 `setData`
- `app/(app)/dashboard/page.tsx`: `fetch` 加 `AbortController`,effect cleanup 中 abort
- `app/(app)/statistics/aging/page.tsx`: `useMemo` 副作用改为 `useEffect`,`refetchAging` 内加请求序号/abort 保护

**参数与 JSON 校验 (五)**:
- `app/api/statistics/export/route.ts`: `minAmount` 转换后检查 `Number.isNaN`,非法时返回 400
- `server/storage/presign.ts`: `contract.attachments` 元素用 Zod schema 校验,异常结构回退空数组

**测试加固 (六)**:
- 修复 `tests/api/signer-contract-detail.test.ts` SALES 隔离断言,使其对本测试 TAG 创建的合同做断言,避免被 seeded 数据污染
- 全量测试: `npm test` 71 文件 / 565 测试全部通过

**版本号**: `0.8.0` → `0.8.1`(patch bump,仅 bugfix + 测试,无 schema 变更,无 breaking change)
**部署说明**: 无 schema 变更,无新迁移;`prisma migrate deploy` 不需要跑;业务上仅 `ADMIN` 缩小合同总额时新增校验,正常流程不受影响

### v0.8.0(2026-07-03)报表中心重做: PDF 5 字段 + 多 sheet Excel + 文件名时间戳

> v0.7.0 报表中心上线后, 跟 2026年5月业务明细.pdf 模板对齐, 把员工业绩做成跟原版一致的"按签约人 + 万元小计"结构。本次覆盖 11 个 commit, 涉及 12 个文件, 0 个新迁移 (数据沿用 v0.7 的 ReportDefinition / ReportSnapshot 表)。

**核心变更 (一) PDF 5 字段对齐**:
- 员工业绩明细表严格按原 PDF 模板 5 列: 所属区域 / 企业名称 / 服务项目 / 签约人 / 合同金额(元)
- 末列"小计(万元)"只在签约人小计行 + 全公司合计行填值, 合同行空
- 签约人小计行"签约人"位置写 "{姓名} 小计", 不带工号; 全公司合计行写 "全公司合计"
- 视觉: 粗黑边框 + 浅黄/灰底色 + 居中表头 + 金额右对齐 + tabular-nums 等宽数字
- 签约明细不再输出: `userId / employeeNo / serviceType 代码 / signDate / contractNo / rowType` (内部主键/枚举 code, 不外露)

**Excel 多 sheet (二)**:
- `lib/excel.ts` 新增 `exportToMultiSheetXlsx` (多 sheet 导出, 31 字符 sheet 名截断, 非法字符转 `_`)
- 报表中心导出 Excel: 1 sheet "员工业绩明细(按签约人)" 6 列; 跟 PDF 字段一一对应
- 删了之前的"员工业绩汇总" sheet (跟 KPI 卡片重复, 跟 PDF 不符)

**数据口径 (三) 改用签约人**:
- 新增 `getSignerSummary` (按 signerId 聚合 合同/开票/回款) 跟 `getSignerContractDetail` (合同级明细) 同维度
- 旧 `getEmployeePerformance` (按 ownerUserId 聚合) 弃用, 但保留兼容 (新 payload.signerSummary 优先)
- 详情页 + Excel + PDF 全部走"签约人"口径, 1 个人在同一张报表里"汇总 + 明细"逻辑自洽

**移除自动生成 (四) 简化**:
- 详情页进入不再静默建快照 (`getOrBuildSnapshot` 拆为 `findSnapshot` 只读 + `generateSnapshot` 显式生成)
- 找不到快照时返 404 + 中文提示, 前端走"未生成"空态 + 大"立即生成报表"按钮
- 删 `server/jobs/report-snapshot.ts` + `runner.ts` 里 cron 调用
- 保留 `scripts/shared/backfill-report-snapshots.ts` (一次性手动补历史用)
- 每日 0 点 cron 不再自动跑报表生成

**API 拆分 (五)**:
- `POST /api/reports/snapshots` body 加 `action` 字段: `snapshotId` 走 `regenerateSnapshot`, `action=generate` 走 `generateSnapshot`, 否则 `findSnapshot`
- `POST /api/reports/export` 支持两种模式: `snapshotId` 走快照, `code+periodType+from/to` 走实时 (CUSTOM 周期永不写快照, 但仍要能导出)
- `server/services/report.ts` 拆出 `buildExportSectionsFromResult` helper, snapshot 和 live 两条路径共用 section 构造

**文件名时间戳 (六)**:
- 所有导出文件名统一 `YYYY-MM-DD_HHMM` 格式 (精确到分), 避免同日多次导出覆盖
- `lib/date-range.ts` 新增 `exportFileTimestamp()` helper, 本地时区
- 影响: reports / statistics / customers / payments / invoices / contracts 共 6 个 export 路由
- PDF 另存: print-html `<title>` 加 `_{periodLabel}_{ts}` 后缀, 浏览器"另存为 PDF"对话框默认用这个名
- Content-Disposition 同步加 `filename="..."` (defensive, 给直接下载的客户端)

**测试 (七)**:
- `tests/api/reports.test.ts` — 重写为 9 个新测试 (findSnapshot 404 / generateSnapshot 创建 / hash skip / CUSTOM live / regenerate / permissions)
- `tests/api/reports-export.test.ts` — 8 个测试 (5 PDF 5 字段 + 1 不再有汇总 + 2 实时查询)
- `tests/api/signer-contract-detail.test.ts` — 3 个新测试 (字段对齐 + SALES 隔离 + 权限)
- 删 `tests/lib/report-period.test.ts` 里 `previousPeriod` 相关测试 (函数一起删)

**生产数据**:
- 跑 `pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2026` 补全 2026 年 1-12 月快照 (36 个组合, 6 月/7 月/Q3/年 是已生成的)
- 2026-07-03 实测 5月员工业绩: 16 个签约人共 62 笔合同, 总 410,880 元 (41.09 万), 跟 PDF 数据完全一致

**版本号**: `0.7.0` → `0.8.0` (minor bump, 新功能为主, 1 个 breaking: 报表中心不再自动生成)
**部署说明**: 无 schema 变更, 无新迁移; `prisma migrate deploy` 不需要跑; `report-snapshot` cron job 已从 `runner.ts` 移除, `qt-jobs.cron` 注释同步去掉; 现有快照数据无需迁移

### v0.7.0(2026-07-03)应收账龄重设计 + 催收功能

> 在 v0.6.0 事故复盘之后,继续推进"应收侧的可控性"建设。本次以 `Invoice.dueDate` + `DunningNote` 为核心,补齐账龄 / 催收 / 跟单的全链路。

**新模型 (一) DunningNote**(8 字段催收记录):
- `server/services/dunning.ts` + `prisma/schema.prisma` 新 model:`DunningNote` (`invoiceId` FK CASCADE → `Invoice`, `actorId` FK RESTRICT → `User` 防 actor 误删)
- 字段:`status` (CONTACTED / PROMISED / DISPUTED / LEGAL) / `promisedDate` / `lastContactAt` / `channel` (PHONE / WECHAT / EMAIL / VISIT) / `remark` / `actorId`
- 索引:`(invoiceId)` / `(status)` / `(actorId, createdAt)`
- 业务语义: 单一催收动作 = 1 行 DunningNote;PROMISED 状态填 `promisedDate`(客户承诺付款日);最近一次联系 = `lastContactAt` 用于"距上次跟进 N 天"提醒

**Schema 增量 (二)**:
- `Invoice.dueDate` (TIMESTAMPTZ, nullable): 合同约定付款日,账龄 `basis=due` 用;为 null 时回退 `actualIssueDate` 计龄。`@@index([dueDate])` 加快扫描
- `Contract.owner` 反向关系补建:之前 `User.ownedContracts` 漏配(只配了 `signedContracts`),导致 `ownerUserName` 渲染走 `String` fallback 而非 `relation` join
- 迁移 `20260703_aging_redesign`(单事务): `ADD COLUMN dueDate` + `CREATE TABLE DunningNote` + 3 索引 + 1 FK + 回填(只有 ISSUED 且 dueDate 为空的发票,默认 `actualIssueDate + 30 天`,其它状态保持 NULL 等用户后续录入)
- 兼容:不动历史 migration,只新增对象,跟 `AGENTS.md` "不可变迁移" 规则一致

**API 路由 (三) 7 条**:
- `GET /api/statistics/aging/by-customer` — 按客户维度分账龄档(0-30/30-60/60-90/90+)
- `GET /api/statistics/aging/by-owner` — 按合同负责人维度(给 SALES 排行 + ADMIN 巡检)
- `GET /api/statistics/aging/trend` — 账龄趋势(对比 7/30/90 天前快照)
- `GET /api/statistics/aging/uninvoiced-contracts` — 未开票合同清单(账龄基于合同止期)
- `GET/POST /api/statistics/aging/dunning-notes` + `[id]` — 催收记录 CRUD(REST 风格)
- `GET /api/statistics/aging/dunning/summary` — 催收汇总(每张发票的最近 N 条催收)

**组件 (四) 4 个**:
- `components/aging-summary.tsx` — 4 档账龄汇总卡片(总应收 / 0-30 / 30-60 / 90+)
- `components/dashboard-aging-mini.tsx` — dashboard 嵌入的迷你账龄视图
- `components/dunning-drawer.tsx` — 催收抽屉(详情页/列表页内嵌,展示 + 新增催收记录)
- `components/authority.tsx` — `<Authority>` 通用权限包装(替换 `lib/permissions.ts` 旧 `useCanX` 系列,统一前端权限渲染)

**统计页改造 (五)**:
- `app/(app)/statistics/aging/page.tsx` — 700+ 行重写,新交互:客户 / 负责人双维度切换 + 催收入口
- `app/(app)/statistics/by-region/page.tsx` / `performance/page.tsx` — 微调联动
- `app/(app)/dashboard/page.tsx` — 加 aging mini
- `app/api/statistics/export/route.ts` / `invoice-aging/route.ts` — 导出 + invoice aging API 适配 dueDate basis

**基础设施 (六)**:
- `lib/permissions.ts` — 加 9 行新资源/动作的权限映射(STATISTICS.AGING_READ, DUNNING.*)
- `lib/i18n.ts` — 加 150+ 行 dunning / aging / authority 词条
- `components/callout.tsx` — 微调
- `server/services/statistics.ts` — 581 行重写,统一 dueDate basis 抽象

**测试 (七)**:
- `tests/api/aging.test.ts` / `aging-api.test.ts` / `dunning.test.ts` — 单测覆盖 3 大 API + 边界(dueDate null 回退 / cascade delete / force actor)
- `tests/api/statistics-aggregation.test.ts` — 加 41 行新场景
- `tests/e2e/15-aging-redesign.spec.ts` — Playwright 端到端(详情页打开催收抽屉 + 录入催收 + 列表显示)

**文档 (八)**:
- `docs/DESIGN-v3.md` — 加 59 行(账龄重设计 + DunningNote 实体 + dueDate basis 规则)
- `docs/USER_MANUAL.md` — 加 27 行(账龄页使用 + 催收流程 + Authority 组件用法)

**版本号**: `0.6.0` → `0.7.0`(minor bump,新功能 + 新 schema,无 breaking change)
**部署说明**: 含 1 个新迁移(`20260703_aging_redesign`),含 DunningNote 表创建 + Invoice.dueDate 加列 + 回填;首次部署后 ISSUED 发票的 dueDate 会被自动回填为 `actualIssueDate + 30 天`,财务可在开票审核时手动覆盖

### v0.6.0 (2026-06-29) cron 静默失败 9 个月事故复盘 + 运维监控 + 修复

> 2025-09 ~ 2026-06-28 期间 cron 静默失败 9 个月无人察觉,恢复后 `tryAutoCloseOnOverdue` 批量强关 209 个 overdue_terminated 合同 + 31 个 admin 误关 + 2 个 completed 异常 = 共 242 个 CLOSED 合同 269 万应收被锁死。本次发版以"修复 + 防再发"为核心。

**修复 (一) reopen + force 旁路** (`4502f182`)：

- **feat(contract)**:新增 `POST /api/contracts/[id]/reopen` 接口, admin 专属, CLOSED → ACTIVE。4 档 `reason` 枚举 (`recovered_from_fake_close` / `data_correction` / `reopen_for_payment` / `other`, `other` 必填 `reasonNote`), 完整事务 + `ContractReviewLog` (`action=MANUAL_REOPEN`) + audit log + `reviewComment` 标记 `reopened:<reason>` 便于追溯
- **feat(payment)**: `createPayment` 加 `force: true` / `forceReason` 旁路, 仅 ADMIN 可用, 仅 CLOSED 合同允许, 业务校验保留 (金额/发票), `remark` 自动追加 `[FORCE_BACKFILL:<reason>]` 审计标记
- **feat(api)**: `POST /api/payments` body 加 `force + forceReason` overlay (不进 `PaymentCreateInput` 主 schema, 避免污染前端类型)
- **docs**: postmortem `docs/cron-silent-failure-postmortem.md` (完整复盘 + 鱼骨图 + 修复时间线) + `docs/contract-fake-close-recovery.md` (修复方案 + 选择指南) + `scripts/migrate/contract-fake-close-recovery.{sql,ts}` (事务 + 备份 + 审计 + 回滚 SQL)
- **部署记录**: 2026-06-29 已执行恢复脚本, 242 个合同已恢复 ACTIVE, 财务可补录回款

**防再发 (二) cron 健康监控** (`af734c28`)：

- **feat(ops)**: `scripts/ops/cron-healthcheck.sh` (183 行) — 每小时第 5 分钟跑的自检脚本, 4 维度检查 (crond 服务 / qt-cron.log 最近 2h 写入 / qt-app 3000 端口 / PostgreSQL 容器 healthy), 失败写日志 + 可选飞书 webhook 告警
- **chore(ops)**: `ops/qt-jobs.cron` 加 `5 * * * * cron-healthcheck.sh` 条目 (跟 `0 * * * * run-all` 错开, 防止互相干扰)
- **feat(deploy)**: `scripts/prod/deploy.sh` 加 deploy 后自检 — `/etc/cron.d/qt-jobs` 必须含 `source .env` + 立即触发 `run-all` 验证 token + 跑一次 `cron-healthcheck.sh` (防 deploy 静默 break cron)
- **feat(events)**: `server/events/bus.ts` `CONTRACT_EXPIRED_UNPAID` 文案分档 — `daysUntilForceClose` ∈ {7, 3, 1} 红色醒目 `⚠️【强关预警】` + 立即处理指引; = 0 时 `⚠️ 今天将被系统强关`; 其它普通 `还剩 N 天`
- **docs**: `docs/USER_MANUAL.md` 新增 §16 运维小贴士 (30 秒自检 / 健康监控 / 强关文案规则 / deploy 报错排查 / 应急处理入口)

**选择指南 (三) postmortem 补 reopen vs force** (`c959b300`)：

- **docs(postmortem)**: `docs/contract-fake-close-recovery.md` 新增 §4.4 / §4.5 — 4 档典型场景对应推荐路径 (历史批量 → SQL / 单合同误关 → reopen / CLOSED 补录 → force / DRAFT 拒绝), 关键提醒 (reopen 后 cron 仍可能再次强关, 正确流程是 reopen → 立即补录 → tryAutoComplete), 接口 curl 示例

**审查修复 (四)** (`dd3cfa29`)：

- **fix(contract)**: 合同操作日志 Timeline SUCCESS 补 `CheckCircleFilled` (`var(--ant-color-success)`) icon, 跟 FAILURE 的 `CloseCircleFilled` 对称
- **chore(contract)**: `reopen` route 文件末尾补 newline (diff 标 `\ No newline at end of file`, eslint 警告)
- **fix(statistics)**: by-region 柱状图 `groupedChartData` 加 `fullName` 字段, tooltip.title 显示完整"区 + 街道"组合 (解决跨区同名镇街在 X 轴重复条目难区分)

**代码清理 (五)** (`07324d63`)：

- **refactor(lib)**: 抽 `serviceTypeLabel(value: unknown): string` helper (lib/enum-maps.ts), 替换 5 处散落的 `SERVICE_TYPE_MAP[v] ?? v ?? "—"` 写法 (客户详情合同 tab / 付款详情 / 合同详情 / xlsx 导出 / PDF 导出), 客户端/服务端通用, 未来新增 serviceType code 不会漏改

**质量基线**：typecheck 0 错误, lint 0 warning, vitest 56 文件 / 452 测试全过, deploy smoke test 全绿, post-deploy cron-healthcheck 5 维度全 OK

**部署期特别提醒**：本次 deploy.sh 已自动跑 cron 自检, 但 `cron-healthcheck.sh` 是新加脚本, 服务器**首次安装**需要手工执行：

```bash
sudo cp /opt/qt/ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo chmod 644 /etc/cron.d/qt-jobs
sudo systemctl restart crond
/opt/qt/scripts/ops/cron-healthcheck.sh --verbose  # 验证
```

后续 deploy 会自动验证 `cron-healthcheck.sh --once`, 不会再"装完忘装"。

### v0.5.1+ (2026-06-29) 增量小修

> 本节汇总 v0.5.1 之后、HEAD 之前的所有 commit(16 个)。覆盖客户状态机下线后的清理、客户统计区间增强、系统 actor 自动状态机、合同默认负责人、证书页 bug、迁移漂移恢复、AI 团队配置。

- **feat(dashboard)**:统计区间支持月度 / 季度 / 年度切换(`StatisticsRange` 新枚举,顶部 Tab 与 URL `?range=` 同步,后端 `getOverview({ range })` 入参)
- **refactor(dashboard)**: `customers.newThisMonth` → `newInRange`(语义对齐统计区间,Top 客户与 dashboard 一致)
- **fix(customer)**:详情页 `select` 移除 v0.5.0 已删的 `status / lastAutoAppliedAt` 字段
- **fix(seed)**:seed upsert system actor(`id=system`)—— 自动状态机转换需要 `actorId`,否则 `tryAutoComplete` / `tryAutoCloseOnExpiry` 抛外键错
- **fix(contract)**:`SALES` 创建合同时 `ownerUserId` 默认 = 当前 user,与详情页 `ownerUserId` 一致;补 `tests/unit/server/contract-create.test.ts` 用例
- **chore(contract)**:合同 Timeline 切 antd 6 API(`TimelineItem dot` → `dot` 接受 ReactNode),失败状态加红 icon
- **chore(payments)**:清未使用的 `Tag` 导入(antd 6 lint 警告)
- **fix(certificates)**:到期证书页 `request` 解包错位(`response` 二层包)→ 直接读 `data.items`
- **chore(db)**:恢复漂移的 3 个迁移文件(从 git 历史找回,不能 `migrate resolve` 凭空标记),加 `docs/db-bootstrap.md` + `prisma db-schema-snapshot.sql` 兜底脚本
- **chore(deps)**:`dev / test / typecheck` 加 `predev` 钩子自动 `prisma generate`,免手动 build 漏掉 client
- **feat(dev)**:登录页测试账号对齐 5 个内置角色(原 4 个,加 `expert` 用于权限矩阵测试,不进快速填充卡)
- **chore(harness)**:初始化 Mavis 团队配置(`.harness/` + `AGENTS.md`),`harness / developer / prisma-expert / backend-expert / ui-expert / code-reviewer` 6 个 rein,详见 [.harness/agent.md](.harness/agent.md)

### v0.5.1(2026-06-28)Excel 导出文件名国际化 + 合同选择器增强

小版本集中修 8 个 xlsx 导出端点(统计 4 / 合同 / 客户 / 回款 / 开票)的 `Content-Disposition` 中文文件名 + 客户端 `downloadExcel` 解析。涉及 [lib/excel.ts](lib/excel.ts) 新增 `attachmentHeader()`,[app/api/statistics/export/route.ts](app/api/statistics/export/route.ts) 等 8 个导出路由 + [app/api/files/raw/[id]/route.ts](app/api/files/raw/%5Bid%5D/route.ts) 文件下载。

- **fix(statistics)**:`区域统计` 等中文 xlsx 文件名在 Node `Headers` API 抛 `TypeError: Cannot convert argument to a ByteString`(byte 22, value 21306)→ 500。统一改 `attachmentHeader()` 走 `filename=ASCII_fallback; filename*=UTF-8''<percent-encoded>` 双形式,老 IE 拿 ASCII、现代浏览器拿 UTF-8。同步覆盖 `/api/files/raw/[id]` 文件下载(`originalName` 也是中文,同一根因)
- **feat(form)**:新建开票 / 登记回款的合同 `ProFormSelect` option label 拼接 `合同号 · 合同标题 · 合同总额`,下拉搜索时可一眼看到合同金额;`Contract` 类型补 `totalAmount: string` 字段
- **fix(payment)**:登记回款 `FormCard` headerHint 渲染 `合同：undefined(客户名)`,根因是 `onChange` 拼 `pickedContract` 时漏塞 `contractNo`。option 改成 `contract: c` 整份合同塞入,`setPickedContract(o?.contract ?? null)`,以后扩字段不会再踩
- **refactor(invoice)**:开票表单合同选择器 option 同步对齐成 `contract: c` 写法,onChange 从 `o.contract?.customerId` 取值,两张表单结构统一
- **refactor(client)**:`lib/excel-client.ts` 的 `downloadExcel` 解析 `Content-Disposition` 之前用 `/filename=([^;]+)/` 拿到 ASCII 兜底而丢掉中文,改成优先 `filename*=UTF-8''` + `decodeURIComponent`,fallback 才退到 ASCII;三个统计页(总览/Top 客户/区域/员工业绩)改用 `downloadExcel(url)`,文件名以服务端 `Content-Disposition` 为单一来源,删手写 `<a download="中文.xlsx">`
- **test(unit)**:`tests/unit/lib/excel.test.ts` 加 4 条 `attachmentHeader` 单测(中文 / 纯 ASCII / 带空格 / `encodeURIComponent` round-trip),11/11 通过;端到端验证 8 个导出端点 200,文件名均带中文

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

- **v0.9.7(2026-07-08)**: 日期与日期时间显示/导出统一为 `YYYY-MM-DD` 风格 — `lib/format.ts` 切到本地时区 + 18 处 `toLocaleDateString/toLocaleString('zh-CN')` 改走中央 helper;空值回退(`""` / `"—"` / `"-"`)按各调用点原地保留
- **v0.8.2(2026-07-04)**: 回滚 9a48265 (CI 暴露 schema migration 冲突, 19 个代码/lib 文件 + 3 migration 目录回退到 ced7665) + README 乱码修复(从 v0.8.1 还原 blob + 追加修复叙事段) + 删 CI/GitHub 自动部署 (改回本地开发 + 运维手动部署)
- **v0.8.0(2026-07-03)**: 报表中心 PDF 5 字段对齐 + Excel 多 sheet + 移除自动生成 (cron 删了, 走手动) + 文件名时间戳 (YYYY-MM-DD_HHMM)
- **v0.6.0(2026-06-29)**:cron 静默失败 9 个月事故复盘 (242 个合同 269 万应收恢复) + reopen API + force 旁路 + cron-healthcheck 自检 + 强关 7/3/1 醒目文案 + postmortem reopen vs force 业务选择指南 + Timeline icon 对称 + serviceTypeLabel helper + by-region Tooltip
- **v0.5.1+(2026-06-29)**:统计区间月度/季度/年度切换 + dashboard 客户统计口径重命名 + system actor seed + 合同 owner 默认值 + 证书页 bug + 迁移漂移恢复 + AI 团队配置 + 清理 18 个孤儿脚本/lib 文件
- **v0.5.1(2026-06-29)**:Excel 导出文件名国际化 + 合同选择器显示合同总额
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
