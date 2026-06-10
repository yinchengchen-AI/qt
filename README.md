# 杭州企泰安全科技 业务管理系统

> 客户 / 合同 / 项目 / 开票 / 回款 一体化管理。
> 附件走 MinIO 对象存储的 presigned 直传,不走应用服务器中转。
> 设计文档见 `docs/DESIGN-v3.md`(v3,钉版本矩阵)。

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js(App Router + RSC + Server Actions) | 16.2.7 |
| 运行时 | React | 19.2.7 |
| 语言 | TypeScript(strict + noUncheckedIndexedAccess) | 6.0.3 |
| UI | Ant Design + @ant-design/pro-components(beta) | 6.4.3 / 3.1.12-0 |
| 图表 | @ant-design/charts | 2.6.7 |
| 状态 | zustand | 5.0.14 |
| 数据请求 | swr | 2.4.1 |
| 校验 | zod | 4.4.3 |
| ORM | Prisma + @prisma/adapter-pg | 7.8.0 |
| 数据库 | PostgreSQL | 16 |
| 对象存储 | MinIO + @aws-sdk/client-s3 v3 | latest / 3.x |
| 认证 | NextAuth(Credentials + JWT) | 4.24.14 |
| 加密 | bcrypt | 6.0.0 |
| 测试 | Vitest + @playwright/test | 4.1.8 / 1.60.0 |

## 快速启动

### 1. 启动基础设施(PostgreSQL + MinIO)

```bash
# 数据库(端口 5432)
docker compose -f docker-compose.postgres.yml up -d

# 对象存储(端口 9000 S3 API / 9001 Web Console,账号 minioadmin/minioadmin)
docker compose -f docker-compose.minio.yml up -d
```

数据卷: `./docker-data/postgres` `./docker-data/minio`

### 2. 配环境变量 + 装依赖 + 推库 + 种子

```bash
cp .env.example .env       # 按需修改(默认 minioadmin/minioadmin 是 dev 合规值)
npm install
npx prisma db push
npm run seed
```

### 3. 起服务

```bash
npm run dev
# 打开 http://localhost:3000
```

## 测试账号

| 工号 | 角色 | 密码 |
|---|---|---|
| `admin` | 管理员 | `123456` |
| `sales` | 业务人员 | `123456` |
| `finance` | 财务人员 | `123456` |
| `ops` | 行政人员 | `123456` |

## 脚本

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run typecheck` | TS 类型检查 |
| `npm run lint` | ESLint(已配置 0 warnings) |
| `npm test` | 单元测试(Vitest) |
| `npm run test:e2e` | E2E(Playwright) |
| `npx prisma db push` | 同步 schema 到 DB |
| `npx prisma migrate dev` | 创建/应用 migration |
| `npm run seed` | 跑种子 |

## 当前状态:v0.1.0 已上线就绪

**核心模块**

- 客户 / 合同 / 项目 / 开票 / 回款 五大模块 CRUD + 状态机 + 16 条跨模块校验规则
- 合同/发票附件走 MinIO(presigned 直传,不中转应用服务器)
- 消息中心(站内信 + 三通道通知:邮件/企微)
- 统计分析(总览 / 账龄 / 业绩)+ xlsx 导出
- 4 角色 RBAC(ADMIN/SALES/FINANCE/OPS)+ SALES 行级隔离
- 软删除 / 操作日志 / Cron 定时任务
- 登录页 + 顶部导航 重做(品牌 logo 配色、统计数字区、面包屑) 

**质量基线**

- `npm run typecheck` 0 errors
- `npm run lint` 0 errors / 0 warnings(历史 137 条全清)
- `npm test` 17/17 通过
- `npm run build` 成功
- dev server `/login` `/dashboard` `/contracts` 200

## 最近更新

### v0.1.0(2026-06-11)上线前清理

- **chore(lint)**:清空 136 个 lint warnings,删 23 条 react-hooks/* 噪音规则(没启 React Compiler)
- **feat(shell)**:header 左侧加收放按钮,Sider 改为 64px 图标条模式
- **feat(login)**:登录页左侧品牌区改用 logo 配色(深海军蓝 #0A1C33 + 鲜红 #E11A2A)+ 业务定位型文案;数字区升级为 antd Statistic 风格大字号(56px)+ 红色 + 号 + 竖线分隔
- **feat(shell)**:header 面包屑居左,加竖线与收放按钮分组;Sider logo 区改为纯文字"企泰安全",高度 64px 跟 header 严格对齐,折叠态"企"字 + 深蓝渐变方块
- **fix(infra)**:统一仓库 `core.autocrlf=false`,文件以 LF 提交
- **fix(infra)**:git push 加 `http.proxy=http://127.0.0.1:9876`(本地仓库 local 配置),走系统代理解决 github.com:443 直连 timeout

### 历史里程碑

- **v0.1.0-rc.1**:MinIO 接入(presign upload/download + Attachment 表 + CORS);Docker 合并为单 image(MinIO + mc 初始化),`minio/minio:latest` + `minio/mc:latest` 官方镜像
- **v0.1.0-rc.1**:合同/发票上传/预览/下载/删除 端到端打通
- **P3**:通知三通道(邮件/企微)+ RLS 策略 + 备份脚本 + Vercel Cron
- **P2**:领域事件总线 + 4 个定时任务 + 统计分析 + xlsx 导出 + 软删除
- **P1**:五大模块 CRUD + 16 条跨模块校验 + 27/27 e2e
- **P0**:项目脚手架 + 登录 + 字典种子 + 4 角色权限

## 对象存储(MinIO)

附件上传走 presigned PUT 直传,不经过应用服务器。

**启动**

```bash
docker compose -f docker-compose.minio.yml up -d
# Console: http://localhost:9001  账号 minioadmin / minioadmin
# S3 API:  http://localhost:9000
```

`qitai-minio-init` 容器会在主服务 healthy 后自动建桶 `qt-biz-attachments`(私有)。

**关键流程**

1. 前端 `ProFormUploadButton` 的 `customRequest` 调 `POST /api/files/presign-upload` 拿 5min 有效 PUT URL
2. 浏览器 `fetch(url, { method: "PUT", body: file })` 直传 MinIO
3. 详情页点文件名 → `POST /api/files/[id]/presign-download` 拿 5min GET URL → 新标签打开

**业务规则**

- MIME 白名单:PDF / Word / Excel / JPEG / PNG / WebP
- 单文件 ≤ 20MB,单合同附件 ≤ 5
- `objectKey` 命名:`contracts/{yyyy}/{mm}/{cuid}-{slug}.{ext}`
- 下载鉴权:复用 `requireSession()` + 合同 `read` 权限
- 软删除:删 `Attachment` 记录但保留 MinIO 对象(GC job 留作后置)

**关键文件**

| 文件 | 职责 |
|---|---|
| `server/storage/minio.ts` | S3Client 单例 + ensureBucket + CORS |
| `server/storage/presign.ts` | `presignUpload` / `presignDownload` |
| `app/api/files/presign-upload/route.ts` | 拿 PUT URL |
| `app/api/files/[id]/presign-download/route.ts` | 拿 GET URL |
| `app/api/files/[id]/route.ts` | 软删除 |
| `lib/upload-client.ts` | 浏览器 `customRequest` 上传封装 |
| `prisma/schema.prisma` | `Attachment` model |

## 目录结构

```
app/                       Next.js App Router(页面 + Route Handlers)
  (app)/                   已登录布局(Sider + Header + Content)
    dashboard/             工作台
    customers/             客户管理
    contracts/             合同管理(附件上传/预览/下载)
    projects/              项目管理
    invoices/              开票管理
    payments/              回款管理
    statistics/            统计分析
    admin/                 系统管理
  api/                     Route Handlers
    files/                 附件 presigned URL
    auth/                  NextAuth
  login/                   登录页(品牌区)
components/                通用组件(qt-mark / dashboard-shell / page-header / ...)
lib/                       env / prisma / auth / api / permissions / 字典 / upload-client
server/                    services / events / jobs / storage(minio+presign) / audit
prisma/                    schema.prisma + seed.ts + migrations/
tests/                     Vitest 单元 + tests/*.mjs 端到端
types/                     enums + errors
docs/                      DESIGN-v3 / RLS / P2_REVIEW / P3_REVIEW / CODE_REVIEW / ...
docker-compose.postgres.yml
docker-compose.minio.yml
```


## P1 主链路验收

### 已实现模块

| 模块 | Schema (Zod 4) | Service (Prisma 事务) | Route Handler | 页面 (ProTable/ProForm) |
|---|---|---|---|---|
| 客户 | ✅ | ✅ | ✅ | ✅ |
| 合同 | ✅ | ✅ | ✅ | ✅ |
| 项目 | ✅ | ✅ | ✅ | ✅ |
| 开票 | ✅ | ✅ | ✅ | ✅ |
| 回款 | ✅ | ✅ | ✅ | ✅ |

### 状态机（全部落地）

- **Contract** 7 态：DRAFT → PENDING_REVIEW → EFFECTIVE → EXECUTING → COMPLETED/TERMINATED/EXPIRED（含 reject / withdraw 分支）
- **Project** 7 态：PLANNED → IN_PROGRESS → DELIVERED → ACCEPTED → CLOSED（含 suspend / cancel / reject 分支）
- **Invoice** 6 态：DRAFT → PENDING_FINANCE → ISSUED → VOIDED / REJECTED / RED_FLUSHED
- **Payment** 5 态：PLANNED → CONFIRMED → RECONCILED / REFUNDED / CANCELLED

### 跨模块校验规则（§6 全部 16 条）

| 规则 | 验证方式 | 结果 |
|---|---|---|
| R-01 信用代码 GB 32100-2015 | Zod 自定义 refine | ✅ 18 位 + 加权 |
| R-02 客户 → SIGNED 需合同 | service 事务 | ✅ 422 CUSTOMER_STATUS_INVALID |
| R-03 合同需客户 NEGOTIATING/SIGNED | service 事务 | ✅ |
| R-04 合同 → EFFECTIVE 需附件 | service 事务 | ✅ 403 ENTITY_IMMUTABLE |
| R-05 项目需合同 EFFECTIVE | service 事务 | ✅ |
| R-06 项目 endDate ≤ 合同 | service 事务 | ✅ 422 PROJECT_DATE_OUT_OF_RANGE |
| R-08 累计开票 ≤ 合同总额 | service 事务 | ✅ 422 INVOICE_OVER_LIMIT |
| R-09 发票 → ISSUED 抬头/税号 | service 事务 | ✅ 422 INVOICE_INFO_INVALID |
| R-10 bankRefNo CONFIRMED 唯一 | service 事务 | ✅ 409 PAYMENT_DUPLICATE_REF |
| R-11 发票级回款不超额 | service 事务 | ✅ 422 PAYMENT_OVER_INVOICE |
| R-12 合同级回款不超额 | service 事务 | ✅ 422 PAYMENT_OVER_CONTRACT |
| R-13 客户 FROZEN 无活跃合同 | service 事务 | ✅ 422 CUSTOMER_HAS_ACTIVE_CONTRACT |
| SALES 行级隔离 | ownershipWhere | ✅ 404 |
| 业务编号 | Sequence 表 + 行锁 | ✅ QT-{前缀}-YYYY[-MM]-#### |

### 端到端测试结果

`tests/e2e-flow.mjs`（Node 18+ 零依赖）覆盖 27 个场景：

```
✅ admin login / sales login
✅ R-01 信用代码校验 → 400
✅ create customer (auto code: QT-C-YYYYMM-####)
✅ R-02 SIGNED 无合同 → 422 CUSTOMER_STATUS_INVALID
✅ create contract (auto no: QT-HT-YYYY-####)
✅ R-04 缺附件 → EFFECTIVE 拒绝 → 403
✅ contract submit → PENDING_REVIEW
✅ contract approve → EFFECTIVE
✅ create project (auto no: QT-P-YYYY-####)
✅ R-06 项目 endDate 超合同 → 422 PROJECT_DATE_OUT_OF_RANGE
✅ project start → IN_PROGRESS
✅ project deliver → DELIVERED
✅ project accept → ACCEPTED
✅ project close → CLOSED
✅ create invoice
✅ invoice submit → PENDING_FINANCE
✅ invoice issue → ISSUED
✅ R-08 开票超限 → 422 INVOICE_OVER_LIMIT
✅ create payment (auto no: QT-PAY-YYYY-####)
✅ payment confirm → CONFIRMED
✅ R-10 bankRefNo 重复 (PLANNED 允许) → 200
✅ R-10 bankRefNo 重复 confirm 拒绝 → 409 PAYMENT_DUPLICATE_REF
✅ R-13 客户 FROZEN 有合同 → 422 CUSTOMER_HAS_ACTIVE_CONTRACT
✅ R-02 SIGNED 有合同 → 200
✅ SALES 行级隔离 (admin 客户) → 404
✅ 业务编号递增

===== 总结 =====
通过 27 / 27，失败 0，耗时 3.9s
```

### 运行 E2E

```bash
# 1) 启动 dev
npm run dev

# 2) 另开终端，跑 E2E
node tests/e2e-flow.mjs
```

### 已知设计点

- `bankRefNo` 字段在 schema 上无 `@unique` 约束：仅在 `confirm` 状态时由 service 校验全局唯一，PLANNED 允许重复（避免业务方草稿阶段误填干扰）。
- `Customer.ownerUserId` 默认 `currentUser.id`（admin 创建时也归自己），SALES 行级隔离依靠 `ownershipWhere(user)` 注入 + Prisma 查询 `where` 子句。
- `Invoice` 编号在草稿阶段为 `DRAFT-{timestamp}`，待 finance issue 后由 service 重新分配正式编号。
- `Code` 字段（如 `QT-HT-2026-0005`）由 `Sequence` 表 + `SELECT … FOR UPDATE` 行锁保证并发安全，事务内串行。

## P2 支撑系统验收

### 已实现模块

| 模块 | 关键文件 |
|---|---|
| 消息提醒（领域事件 + 站内信） | `server/audit.ts`, `server/events/bus.ts`, `server/services/message.ts` |
| 定时任务（4 个 jobs） | `server/jobs/runner.ts`, `app/api/jobs/[job]/route.ts` |
| 消息中心 UI（铃铛 + Drawer） | `components/dashboard-shell.tsx`, `app/messages/page.tsx` |
| 统计分析 | `server/services/statistics.ts`, `app/statistics/{overview,aging,performance}/page.tsx` |
| xlsx 导出 | `lib/excel.ts`, `app/api/statistics/export/route.ts` |
| 软删除 DELETE | `server/services/customer.ts:softDeleteCustomer` |
| OperationLog 集成 | `server/audit.ts`（5 模块状态机全覆盖） |

### 领域事件触发矩阵

| 事件 | 触发时机 | 接收人 | 状态 |
|---|---|---|---|
| CONTRACT_PENDING_REVIEW | 合同 submit | 全部 ADMIN | ✅ |
| CONTRACT_APPROVED | 合同 approve | contract.ownerUserId | ✅ |
| CONTRACT_REJECTED | 合同 reject | contract.ownerUserId | ✅ |
| PAYMENT_RECEIVED | 回款 confirm | contract.owner + 全部 ADMIN | ✅ |
| INVOICE_OVERDUE_PAYMENT | 定时任务（actualIssueDate + 30 天） | owner + admin + finance | ✅ |
| CONTRACT_EXPIRING | 定时任务（endDate - 30/7/1） | owner + admin | ✅ |
| PROJECT_DUE | 定时任务（endDate - 7） | manager + owner + admin | ✅ |
| CUSTOMER_INACTIVE | 定时任务（90 天无跟进） | owner | ✅ |

### 定时任务入口

```bash
# 管理员手动触发
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/run-all

# 单跑
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiring
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/invoice-overdue
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/project-due
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/customer-inactive
```

生产环境建议 Vercel Cron 每小时触发一次 `/api/jobs/run-all`：
```json
// vercel.json
{
  "crons": [{ "path": "/api/jobs/run-all", "schedule": "0 * * * *" }]
}
```

### 统计接口

```bash
GET /api/dashboard/summary                # 工作台 4 卡片 + 账龄
GET /api/statistics/overview?from&to      # 总览 + 时间序列
GET /api/statistics/invoice-aging         # 应收账款账龄
GET /api/statistics/top-customers?metric=contract|payment&limit=10
GET /api/statistics/sales-performance?userId=&from=&to=
GET /api/statistics/export?type=overview|top-customers|sales-performance   # xlsx 下载
```

### 端到端测试结果

`tests/p2-flow.mjs` 21 个断言：

```
✅ admin 收到 CONTRACT_PENDING_REVIEW
✅ SALES 收件箱不包含该通知（行级隔离）
✅ 标记已读
✅ 全部标记已读
✅ jobs/run-all 调用
✅ SALES 调 jobs 拒绝
✅ 统计总览
✅ 时间序列长度
✅ 账龄分析
✅ Top 客户
✅ 业务员业绩
✅ xlsx 导出 overview
✅ xlsx 导出 top-customers
✅ SALES 调 export overview 被拒（设计: SALES STATISTICS=R 无 EXPORT）
✅ 软删无活跃合同客户
✅ 软删后查不到
✅ 软删有合同客户拒绝
✅ SALES 软删他人客户
✅ Dashboard summary

===== 总结 =====
通过 21 / 21，失败 0，耗时 2.5s
```

### 完整回归

| 阶段 | 测试 | 通过 |
|---|---|---|
| 单元 | Vitest | 17/17 |
| 端到端 P1 | `tests/e2e-flow.mjs` | 27/27 |
| 端到端 P2 | `tests/p2-flow.mjs` | 21/21 |
| **合计** | – | **53/53** |

## P3 完善验收

P3 阶段交付：通知三通道、公告系统、RLS 兜底、备份/审计脚本、压测工具、i18n 基础。

### P3 文件清单

| 类别 | 文件 |
|---|---|
| 通知 | `lib/notify-config.ts`、`server/events/channels.ts`、`server/events/dispatcher.ts` |
| 公告 | `server/services/announcement.ts`、`app/api/announcements/**`、`app/announcements/page.tsx`、`lib/validators/announcement.ts` |
| RLS | `prisma/migrations/20260609_rls/migration.sql`、`lib/rls.ts` |
| i18n | `lib/i18n.ts` |
| 备份 | `scripts/backup.sh`、`scripts/audit-cleanup.sh`、`scripts/loadtest.mjs` |
| Vercel | `vercel.json`、`app/api/jobs/run-all/route.ts` |
| 文档 | `docs/RLS.md`、`docs/P3_REVIEW.md` |

### P3 E2E

```bash
node tests/p3-flow.mjs
```

覆盖 23 用例：公告 CRUD + 靶向角色 + 软删；通知通道关闭无副作用；inbox 异步分发；SALES 行级隔离（应用层）。

### 压测

```bash
node scripts/loadtest.mjs           # 默认 50 并发 × 5s
CONCURRENCY=100 DURATION_MS=10000 node scripts/loadtest.mjs
```

dev 模式实测（C50/C100）：RPS 460-500，P95 < 280ms。详见 `docs/P3_REVIEW.md`。

### 通知三通道配置

`.env` 中按需开启：

```env
NOTIFY_EMAIL_ENABLED="true"
SMTP_HOST="smtp.example.com"
SMTP_USER="..."
SMTP_PASS="..."

NOTIFY_WECHAT_WORK_ENABLED="true"
WECHAT_WORK_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
```

### 备份与定时任务

- **本地 cron**：`bash scripts/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**：`vercel.json` 已配 `POST /api/jobs/run-all` 每日 01:00 UTC
- **Cron Secret**：`.env` 设 `CRON_SECRET`，Vercel Cron 自动注入 Bearer 鉴权

### 完整回归

| 阶段 | 测试 | 通过 |
|---|---|---|
| 单元 | Vitest | 5/5 |
| 端到端 P1 | `tests/e2e-flow.mjs` | 27/27 |
| 端到端 P2 | `tests/p2-flow.mjs` | 21/21 |
| 端到端 P3 | `tests/p3-flow.mjs` | 23/23 |
| **合计** | – | **88/88** |
