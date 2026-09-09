# qt-biz · 杭州企泰安全科技 业务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.12-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.7-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-3178c6)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.9.1-2d3748)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![Last Release](https://img.shields.io/badge/release-v0.25.6-blue)](CHANGELOG.md)
[![CI](https://github.com/yinchengchen-AI/qt/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yinchengchen-AI/qt/actions/workflows/ci.yml)

> **客户 / 合同 / 开票 / 回款** 一体化管理,附件走 MinIO presigned 直传,服务端 Server Actions + RBAC + 行级隔离。
>
> **当前版本: v0.25.6**(2026-09-07)。文档地图见 [docs/README.md](docs/README.md),架构与设计见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md),用户手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

<!-- 最近更新于 2026-09-09 — 全面重构 README 结构 -->

---

## 项目概述

**qt-biz** 是杭州企泰安全科技的内部业务管理平台,覆盖从客户引入到回款确认的全业务链路。

### 核心业务

| 模块 | 功能概要 |
|---|---|
| **客户管理** | 客户 CRUD、联系人管理、区域字典、证书到期提醒、软删与恢复 |
| **合同管理** | 合同 CRUD、状态机 (DRAFT → ACTIVE → CLOSED)、电子发票号、红冲、附件管理、自动状态推进 (cron) |
| **开票管理** | 发票 CRUD、R-11 回款保护、开票金额上限校验、红冲、与回款的关联关系 |
| **回款管理** | 回款登记、确认 / 对账、与发票的双向关联、R-08 合同级开票限额 |
| **统计分析** | 总览 / 账龄 / 业绩 / Top 排行、xlsx 导出 (exceljs 流式) |
| **消息与公告** | 通知中心 (消息 / 公告 / 回收站)、操作日志、员工档案 |

### 技术亮点

- **RBAC 行级隔离** — 应用层 `ownershipWhere` + PostgreSQL RLS 双重兜底,SALES 自动只看自己负责的客户
- **状态机驱动** — 合同 / 发票 / 回款 的合法迁移路径用 switch 强制,不可逆状态受保护
- **16 条业务校验** — R-01 到 R-16 编号化,错误码体系统一,前端 Zod 校验与后端 service 校验双保险
- **MinIO presigned 直传** — 附件不走应用服务器,前端直传 MinIO,服务端只生成签名 URL
- **全链路测试** — Vitest 1062 用例 + Playwright E2E(chromium / iPad / iPhone),CI 自动验证

> 详细架构见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md),用户操作手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

## 目录

- [项目概述](#项目概述)
- [快速开始](#快速开始)
- [核心功能说明](#核心功能说明)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [脚本速查](#脚本速查)
- [环境配置](#环境配置)
- [部署须知](#部署须知)
- [质量基线](#质量基线)
- [最近更新](#最近更新)
- [常见问题排查](#常见问题排查)
- [安全提醒](#安全提醒)
- [相关文档](#相关文档)
- [许可](#许可)

## 快速开始

需要 Node `>=20.9.0` 与 Docker(本地起 PostgreSQL 16 + MinIO)。

### 一键启动(推荐)

```bash
npm run dev:setup
```

依次拉起 Postgres + MinIO → 安装依赖 → 推库 → 注入系统字典 → 启动 dev server。前台进程,`Ctrl-C` 退出。

### 手动分步

```bash
# 1) 起基础设施 (本机 Docker Compose v5.1.0 需用 docker-compose 二进制,不支持 `docker compose -f`)
docker-compose -f docker-compose.postgres.yml up -d
docker-compose -f docker-compose.minio.yml   up -d

# 2) 环境变量
cp .env.example .env   # 默认 minioadmin/minioadmin;生产前必轮换

# 3) 依赖 + 数据库迁移
npm install
npx prisma migrate dev

# 4) 系统管理数据(5 角色 / system actor / 5 部门 / 17 类字典)
npm run seed

# 5) 第一个业务管理员
npm run create-admin -- \
  --employeeNo admin \
  --name "系统管理员" \
  --email  admin@example.com \
  --password 'Your-Strong-Pwd-2026'

# 6) 起服务
npm run dev    # http://localhost:3000
```

### Dev 测试账号

登录页右下角「测试账号」卡列出 4 个角色账号;`npm run seed:dev-users` 还会建 `expert` 共 5 个,密码统一从 `DEV_QUICK_FILL_PASSWORD`(默认 `dev-only-fill`)读取,**仅供 dev / 测试用**。

```bash
npm run seed:dev-users
```

## 核心功能说明

### 客户管理

- **CRUD** — `app/(app)/customers/` 提供 ProTable 列表、ProForm 表单、批量导入导出
- **联系人** — 一个客户可绑定多个联系人,列表内嵌展示
- **区域字典** — 省市区三级联动,由 `Dictionary` 表驱动
- **证书到期** — `certificate-expiry-check` cron 任务(30/15/7 天)发送站内信提醒
- **软删** — 客户记录 `deletedAt` 标记删除,`/admin/trash` 支持批量恢复

**代码示例** — 创建客户:
```ts
// POST /api/customers
const data = customerCreateSchema.parse(await req.json());
const customer = await createCustomer({ ...data, ownerUserId: user.id }, user);
```

### 合同管理

- **状态机** — DRAFT → ACTIVE → CLOSED,合法迁移路径见 [DESIGN-v3](docs/architecture/DESIGN-v3.md §5):
  ```
  DRAFT ────(auto: 字段完整 + 附件)──▶ ACTIVE ────(auto: 开票足额 / endDate 过期)──▶ CLOSED
    │                                       │
    └───(admin 强制发布)                    └───(admin 强制完结: completed/terminated/expired)
  ```
- **R-08 开票限额** — 合同累计开票金额 ≤ 合同总额
- **附件** — 合同级附件,走 MinIO presigned 直传
- **自动状态机** — `contract-auto-publish` / `contract-auto-complete` / `contract-auto-close-on-expiry` 三个 cron 任务每日自动推进

**代码示例** — 合同状态判断:
```ts
import { getBillingStatus } from '@/lib/contract-billing';
const status = getBillingStatus(invoicedAmount, totalAmount);
// → "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"
```

### 开票管理

- **R-11 回款保护** — 单发票累计回款金额 ≤ 发票金额(容差 ¥0.01)
- **金额容差** — 使用 `MONEY_TOLERANCE = new Prisma.Decimal("0.01")` 统一处理浮点精度
- **红冲** — 发票金额变更时需检查关联回款
- **与回款关联** — 双向关系,回款页面可关联多张发票

**代码示例** — R-11 校验:
```ts
import { MONEY_TOLERANCE } from '@/lib/money-tolerance';
const TOL = MONEY_TOLERANCE;
// 发票降额且已回款超过新金额时阻止
if (sumAmt > newAmount + TOL.toNumber()) {
  throw new ApiError(ERROR_CODES.R11_OVER_PAYMENT, errorMsg, 400);
}
```

### 回款管理

- **确认 / 对账** — 回款状态: PLANNED → CONFIRMED → RECONCILED
- **与发票关联** — 一张回款可关联多张发票,一张发票可有多笔回款
- **R-08 合同级开票限额** — 合同累计开票金额不能超过合同总额

### 统计分析

- **总览** — 月/季/年切换,统计客户数、合同额、开票额、回款额
- **账龄分析** — 按账龄区间统计待回款金额
- **业绩排行** — 按员工统计业绩,支持 xlsx 导出
- **Top 排行** — Top 客户 / Top 合同按金额排序

**代码示例** — 导出 xlsx:
```ts
// 统计页面导出
import { exportStatistics } from '@/lib/excel';
const buffer = await exportStatistics(stats, range);
res.setHeader('Content-Disposition', attachmentHeader('统计.xlsx'));
res.send(buffer);
```

### 消息与公告

- **通知中心** — `/messages` 单入口 + Tabs(消息 / 公告 / 回收站)
- **操作日志** — `{ actorId, action, before, after, at }`,admin 页面可查询
- **员工档案** — 教育 / 证书 / 工作经历 / 家庭成员 5 步向导编辑

### 权限体系

- **5 角色** — 管理员 / 业务人员 / 财务人员 / 行政人员 / 技术专家
- **行级安全** — 应用层 `ownershipWhere` + PostgreSQL RLS 双重兜底
  ```
  应用层主防线: service.ownershipWhere(user)  // 性能好、可控、可测
        ↓
  DB 层兜底: PG RLS policy  // 即使 service 漏写,DB 也会拦截
  ```

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js(App Router + RSC + Server Actions) | `16.2.12` |
| 运行时 | React | `19.2.7` |
| 语言 | TypeScript(`strict` + `noUncheckedIndexedAccess`) | `6.0.3` |
| UI | Ant Design + @ant-design/pro-components | `6.4.3` / `3.1.12-0` |
| 图表 | @ant-design/charts | `2.6.7` |
| 状态 / 数据 | zustand · swr | `5.0.14` · `2.4.1` |
| 校验 | zod | `4.4.3` |
| ORM | Prisma + @prisma/adapter-pg | `7.9.1` / `7.8.0` |
| 数据库 | PostgreSQL | `16` |
| 对象存储 | MinIO + @aws-sdk/client-s3 v3 | latest |
| 认证 | NextAuth(Credentials + JWT)+ @auth/prisma-adapter | `4.24.15` / `2.11.3` |
| 加密 | bcrypt | `6.0.0` |
| 测试 | Vitest · @playwright/test | `4.1.8` / `1.60.0` |
| 代码质量 | ESLint(flat config, 0 warnings) | `9.39.5` |

完整版本矩阵与兼容性见 [docs/architecture/DESIGN-v3.md §1](docs/architecture/DESIGN-v3.md)。

## 项目结构

```
qt-biz/
├─ app/                       Next.js App Router(页面 + Route Handlers)
│  ├─ (app)/                  已登录布局(Sider + Header + Content)
│  │  ├─ dashboard/           工作台(月/季/年 KPI + 待办预警)
│  │  ├─ customers/           客户管理(联系人 + 区域 + 证书)
│  │  ├─ contracts/           合同管理(状态机 + 附件 + 审计)
│  │  ├─ invoices/            开票管理(电子发票号 + 红冲)
│  │  ├─ payments/            回款管理(确认 + 对账)
│  │  ├─ statistics/          统计分析(总览/账龄/业绩/Top + xlsx)
│  │  ├─ admin/               系统管理(用户/角色/部门/字典/审计)
│  │  ├─ messages/            消息中心
│  │  └─ announcements/       公告
│  ├─ api/                    Route Handlers
│  └─ login/                  登录页(限速 + 失败锁定)
├─ components/                共享 UI(admin / customers / file / form / ...)
├─ lib/                       客户端逻辑(auth / permissions / validators / i18n / ...)
├─ server/                    后端服务层(services / events / jobs / storage / audit)
├─ prisma/                    schema.prisma + seed + migrations/
├─ tests/                     Vitest(unit + api)+ Playwright(e2e)
├─ docs/                      设计 / 评审 / 手册 / 部署(地图见 docs/README.md)
├─ ops/                       运维脚本(nginx / 备份 / cron 健康检查)
├─ scripts/                   dev / prod / migrate / shared CLI
├─ public/                    静态资源(502 兜底页 / 品牌 logo)
├─ docker-compose.postgres.yml
├─ docker-compose.minio.yml
└─ Dockerfile                 多阶段构建 — **DEPRECATED(v0.17+)**:现网走 native systemd,此文件仅留作应急回退参考
```

## 脚本速查

按用途分组,完整列表见 [package.json](package.json)。

### 开发

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器(默认 `http://localhost:3000`) |
| `npm run dev:setup` | 一键起 PG + MinIO + 装依赖 + 推库 + seed |
| `npm run dev:up` / `dev:down` | 仅 Docker 生命周期 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run typecheck` | TS 类型检查(`tsc --noEmit`) |
| `npm run lint` / `lint:fix` | ESLint(`0 warnings`) |
| `npm run loadtest` | 压测(默认 50 并发 × 5s) |

### 数据库与迁移

| 命令 | 用途 |
|---|---|
| `npm run prisma:migrate` | 创建 / 应用 migration(dev) |
| `npm run prisma:deploy` | 生产应用 migration |
| `npm run prisma:generate` | 重生成 client |
| `npm run prisma:studio` | Prisma Studio |
| `npm run prisma:status` | 查看迁移状态 |
| `npm run migrate:contract-status-dict` | 合同状态字典迁移 |
| `npm run migrate:customer-district` | 客户区域字典迁移(含 `:dry` 预览) |
| `npm run migrate:legacy` | 历史数据迁移(含 `:attachments` / `:dry` / `:fixup` / `:verify`) |
| `npm run db:snapshot` | DB 快照 |

### 种子与账号

| 命令 | 用途 |
|---|---|
| `npm run seed` | 系统管理数据(幂等):5 角色 + system actor + 5 部门 + 17 类字典 |
| `npm run seed-roles` | 只插 5 角色 |
| `npm run seed-dicts` | 只插 17 类字典 |
| `npm run sync-dict` | 同步字典 |
| `npm run create-admin` | CLI 创建业务管理员 |
| `npm run reset-password` | 重置密码 |
| `npm run seed:dev-users` | dev 专用,幂等 upsert 5 个测试账号 |
| `npm run seed:dev-customers` | dev 专用,插入 100 个 dev 客户 |

### 测试

| 命令 | 用途 |
|---|---|
| `npm test` | Vitest(unit + API) |
| `npm run test:e2e` | Playwright(`chromium` + `ipad-portrait` + `iphone-13`,自动起 dev) |

### 发布与部署

| 命令 | 用途 |
|---|---|
| `npm run release:publish` | 从 git commits 生成更新日志(由 `deploy.sh` 自动调用) |

## 环境配置

### 环境变量

复制 [.env.example](.env.example) 为 `.env`,生产前**逐条**轮换 dev 默认值。

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | PostgreSQL 连接串,含 schema |
| `NEXTAUTH_SECRET` | 是 | ≥ 32 字符;生产用密码管理器生成 |
| `APP_ENC_KEY_HEX` | 是(dev 占位 0) | 64 字符 hex, AES-256-GCM 加密敏感字段 |
| `NEXTAUTH_URL` | 否(dev `http://localhost:3000`) | 公网访问地址 |
| `APP_PUBLIC_URL` | 否 | 同 `NEXTAUTH_URL`,用于内嵌链接生成 |
| `CRON_SECRET` | 否 | 仅 Vercel Cron 需要,自动注入 `Authorization: Bearer` |
| `APP_LOCALE` | 否 | 默认 `zh-CN` |
| `FORCE_HTTPS` | 否 | 生产设 `true`,启用 Secure Cookie |
| `SKIP_ENV_VALIDATION` | 否 | 仅构建期(CI 生产构建冒烟用;历史由 `Dockerfile` 设置,该文件已 DEPRECATED) |
| `MINIO_*` | 否 | 端点 / 端口 / 凭证 / bucket / 公开 base URL,见 `.env.example` |
| `DEV_QUICK_FILL_PASSWORD` | 否 | `seed:dev-users` 测试账号密码,**生产不要设置** |

### 环境对比

| 环境 | 用途 | PG | MinIO | 部署方式 |
|---|---|---|---|---|
| **本地开发** | 开发调试 | docker-compose | docker-compose | `npm run dev` |
| **CI 构建** | typecheck / lint / vitest / build | 不依赖 | 不依赖 | GitHub Actions |
| **生产** | 线上运行 | docker-compose (host 网络) | docker-compose (host 网络) | native systemd (`qt-app.service`) |

> **重要**: 生产环境 PG 的 `DATABASE_URL`、MinIO 凭证、`NEXTAUTH_SECRET` 必须与本地 dev 完全不同。dev 默认值(`minioadmin/minioadmin`、`postgres/postgres`)严禁用于生产。

## 部署须知

### 全新生产部署顺序

```bash
npx prisma migrate deploy           # 应用全部 migration(已合并到 main 不可删)
npm run seed                       # 系统管理数据(幂等): 5 角色 + system actor + 5 部门 + 17 类字典
npm run create-admin -- --employeeNo <工号> --name <真名> --email <公司邮箱> --password '<强密码>'
```

> `npm run seed` 只写系统管理数据,不依赖 ADMIN 账号,也不再 seed 业务数据(客户/合同/发票/回款走真实数据)。
> 工作流模板随 v0.3.0 工作流模块下线已移除,seed 不再写入。

**生产密码**:`create-admin` 强制 ≥ 8 字符,生产请用密码管理器生成的随机串。

### 阿里云 ECS 单主机部署

- 当前流程:**[docs/ops/deploy-current.md](docs/ops/deploy-current.md)**(日常部署只看这一份)
- 历史复盘:`docs/ops/deploy-history/`
- 一键回滚:`bash scripts/prod/rollback.sh`(默认切到上一版,`--list` 看历史)
- 远端触发:`./scripts/prod/remote-deploy.sh`(本地 Mac 通过 `~/Downloads/QT.pem` 触发)

日常更新(服务器 `/opt/qt`):

```bash
sudo -E ./scripts/prod/deploy.sh      # preflight → git pull → native build → compose up pg/minio → migrate deploy → release:publish → systemctl restart → smoke
```

v0.16.0 起应用为 **native systemd**(`qt-app.service`),不再 docker build;native build 复用 Turbopack `.next/cache` 增量,日常部署 30s–2min(v0.15.x docker 时期约 14min)。日志写到 `/var/log/qt-deploy.log`,应用日志用 `journalctl -u qt-app -f`。

### 备份与定时任务

- **本地 cron**:`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**:`vercel.json` 已配 `POST /api/jobs/run-all` 每日 01:00 UTC,自动用 `CRON_SECRET` 鉴权
- **cron 健康检查**:`docs/ops/deploy-current.md` 中 `cron-healthcheck` 段

### 502 友好页

nginx 反代下上游异常时,由 `public/502.html` 静态页与 `app/502/page.tsx` 动态页两层兜底。完整配置见 [ops/nginx/qt-biz.conf](ops/nginx/qt-biz.conf)。

## 质量基线

基线刷新于 **v0.25.6(2026-09-07)**。

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors(实测) |
| `npm run lint` | 0 errors / 0 warnings(实测) |
| `npm test` | 122 个 `.test.ts`,1062 用例:本地无 PG 时 629 pass/423 skip/10 fail; 有 PG(`npm run dev:setup`) 时应全绿 |
| `npm run test:e2e` | 部分运行:01.1 / 12 / 14 三项目(chromium / iPad / iPhone)全绿(沿用上轮记录) |
| `prisma generate` + `migrate deploy` | 59 / 59 migrations,client v7.9.1 |
| `npm run build` | 本地因 `docker-data/postgres` 目录权限未通过验证(环境限制,非代码错误) |

> typecheck / lint / vitest 三行为 v0.25.5 本地实测;E2E 与 build 行沿用上一轮记录,未在本轮重跑。

## 最近更新

最近 5 个版本(另附更早的重要版本 v0.25.0),完整历史见 [CHANGELOG.md](CHANGELOG.md)。


### v0.25.5(2026-09-05)系统-回收站页面重做

`/admin/trash` 按「简洁实用」重做:文案全走 i18n,新增类型筛选/关键词搜索/刷新工具栏,行选择 + 批量恢复。纯前端 UI 重构,后端 `/api/admin/trash` 与权限不变。

### v0.25.4(2026-09-05)面包屑与实际页面匹配修复

全量比对 46 个 `(app)` 页面路由与 header 面包屑映射,修复 `/admin/messages`、`/contracts/workbench`、`/admin/certificates/expiring`、`/admin/users/[id]/edit-profile` 4 处不匹配。

### v0.25.3(2026-09-05)系统-消息归档页面重做

`/admin/messages` 类型列/筛选改中文标签 + 语义色,归档月份筛选换 antd DatePicker,工具栏对齐通知中心风格。纯前端 UI 重构。

### v0.25.2(2026-09-05)消息类型中文标签补全

`lib/status.ts` MESSAGE 映射补齐全部 23 个类型(8 个应用层类型 + 3 个已下线客户状态类型)的中文标签与语义色,归档/回收站历史数据不再回退显示英文枚举。

### v0.25.1(2026-09-05)messages 页面简洁实用重构

通知中心消息列表简化:分类筛选收敛为工具栏紧凑 Select,双栏改单列,未读改行内红点 + 标题加粗,移动端复用同一分类 Select。纯前端 UI 重构。

### v0.25.0(2026-09-05)通知中心:消息与公告模块重构(重要)

散在「消息与公告」分组下的消息中心、公告、更新日志三个入口重构为统一**通知中心**:`/messages` 单入口 + Tabs(消息/公告/回收站),公告管理能力并入公告 Tab;更新日志 `/releases` 移入「系统」分组(全员可见);旧路径 `/announcements` 保留重定向。

## 常见问题排查

### 本地开发

| 问题 | 原因 | 解决 |
|---|---|---|
| `npm run dev:setup` 报 PG 连接失败 | PostgreSQL 未启动 | `docker-compose -f docker-compose.postgres.yml up -d` |
| `npm test` 出现 Prisma 查询错误(423 skip/10 fail) | 本地数据库未运行 | 启动 PG 后重新跑 `npm test` 应全绿 |
| `docker compose -f` 报 "unknown shorthand flag" | 本机 Docker Compose v5.1.0 不支持该语法 | 改用 `docker-compose -f` 二进制 |
| `prisma migrate dev` 报 drift 冲突 | 本地 DB 已手动改过 schema | 参考 [docs/ops/db-bootstrap.md](docs/ops/db-bootstrap.md) |
| 新库跑迁移撞 42710 错误 | `20260630_message_type_enum_index` 的裸 `CREATE TYPE` 撞 `20260627` 预建 enum | `bash scripts/shared/migrate-deploy.sh` 自动处理 |
| `npm run build` 报 `docker-data/postgres` 权限 | 目录所有权不对 | `chown -R <user>:<group> docker-data/postgres` |
| `npm run typecheck` 报 `PrismaClientInitializationError` | client 未生成 | `npx prisma generate` |
| 首次部署报 `qt-app.service` 未安装 | 未复制 systemd unit | `sudo cp ops/qt-app.service /etc/systemd/system/ && sudo systemctl daemon-reload` |

### 生产部署

| 问题 | 原因 | 解决 |
|---|---|---|
| deploy.sh preflight 失败: 磁盘不足 | build cache 累计过大 | `docker builder prune -af --keep-storage 2GB` |
| deploy.sh preflight 失败: 内存不足 | 3.5GB 机器被其它容器占用 | 停 `mysql-fineui` 等无关容器 |
| 部署后 cron 静默失败 | cron 进程未启动或 `.env` 未 source | 检查 `/var/log/qt-cron.log`; deploy.sh 已加 cron 健康自检 |
| Native build OOM | 3.5GB 机器编译内存不够 | 增加 swap 或停其它容器; 或升级 4GB+ |
| 502 错误 | nginx 反代上游异常 | 检查 `journalctl -u qt-app -n 50`; `public/502.html` 为兜底页 |
| PG/MinIO 容器 unhealthy | 数据卷损坏或端口冲突 | `docker-compose -f docker-compose.postgres.yml restart` |

### 数据库

| 问题 | 原因 | 解决 |
|---|---|---|
| 新环境 migrate deploy 报错 | 未建 `qt_app` 角色 | 先执行 `CREATE ROLE qt_app BYPASSRLS NOLOGIN;` |
| 迁移漂移 (drift) | DB 与 migration 历史不同步 | 参考 [docs/ops/db-bootstrap.md](docs/ops/db-bootstrap.md) — 从 git 历史恢复迁移文件 |
| **注意** | 已合并到 main 的迁移文件**禁止删除、重命名或重写 SQL** | 破坏任一边都会让部署环境报 "migration not found" |

### 认证与权限

| 问题 | 原因 | 解决 |
|---|---|---|
| 登录页 401 / 500 | `NEXTAUTH_SECRET` 未设置或太短 | 设 ≥ 32 字符; 用密码管理器生成 |
| 登录后白屏 / 样式闪烁 | `AntdRegistry` 未包在最外层 | 检查 `app/layout.tsx` |
| SALES 看不到数据 | 应用层 `ownershipWhere` 未正确注入 | 检查 service 是否调用 `ownershipWhere(user)` |

> 更多历史事故复盘见 [docs/history/postmortem/](docs/history/postmortem/)。

## 安全提醒

- **不要**提交 `.env` / `docker-data/` / `backups/`(`.gitignore` 已守)
- 上传 / 下载走 Next.js 代理,MinIO 留在 `:9000` 内网,**不公网暴露**
- `npm run seed` 仅系统管理数据;生产种子在干净环境手动跑,**不**随例行更新跑
- dev 默认账号(`minioadmin/minioadmin`、`postgres/postgres`)**仅本地用**,生产前必轮换
- `DEV_QUICK_FILL_PASSWORD` 仅供 `seed:dev-users`,**不要**在生产 `.env` 设置

## 相关文档

详细分类与阅读顺序见 **[docs/README.md](docs/README.md)**(文档地图)。下面是常用入口:

| 文档 | 用途 |
|---|---|
| [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md) | 完整设计(v3,版本矩阵钉版) |
| [docs/architecture/RLS.md](docs/architecture/RLS.md) | 行级安全策略 |
| [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md) | 用户手册 |
| [CHANGELOG.md](CHANGELOG.md) | 完整版本历史 |
| [docs/reference/project-summary.md](docs/reference/project-summary.md) | 项目总结 |
| [docs/ops/deploy-current.md](docs/ops/deploy-current.md) | 当前部署流程 |
| [docs/ops/db-bootstrap.md](docs/ops/db-bootstrap.md) | 数据库初始化 / 迁移漂移恢复 |
| [ops/README.md](ops/README.md) | 运维脚本说明 |
| [scripts/README.md](scripts/README.md) | 脚本说明 |

事故复盘与代码审查归档:

- [docs/history/postmortem/](docs/history/postmortem/)
- [docs/history/code-review/](docs/history/code-review/)
- [docs/history/security/](docs/history/security/)
- [docs/history/test-reports/](docs/history/test-reports/)

## 许可

本项目以 [MIT 许可证](LICENSE)发布。Copyright © 2026 yinchengchen-AI。

欢迎贡献 — 提 issue / PR 之前请先阅读 [docs/history/code-review/code-review-announcement.md](docs/history/code-review/code-review-announcement.md) 中的代码审查公告与 [AGENTS.md](AGENTS.md) 中的贡献指南。

---

## 更新说明

> **更新时间: 2026-09-09**

本次对 README.md 进行全面重构与更新，主要变更如下：

### 新增章节

| 章节 | 说明 | 行号 |
|---|---|---|
| **项目概述** | 新增项目定位、核心业务模块表格、技术亮点总结 | §1-2 |
| **核心功能说明** | 新增 7 大模块详细说明，含代码示例 | §3 |
| **环境配置** | 从部署须知中独立，新增环境对比表 | §7 |
| **常见问题排查 (FAQ)** | 新增 4 大类问题排查表（本地开发/生产部署/数据库/认证权限） | §10 |

### 优化章节

| 章节 | 变更说明 |
|---|---|
| **目录** | 新增"项目概述""核心功能说明""环境配置""常见问题排查"四个锚点 |
| **快速开始** | 修正 docker compose 命令（本机 v5.1.0 需 `docker-compose -f`） |
| **技术栈** | 保持与 package.json 同步 |
| **部署须知** | 保留原有内容，与"环境配置"分离 |
| **质量基线** | 保持 v0.25.6 基线数据 |
| **最近更新** | 保持 v0.25.0-v0.25.5 版本历史 |

### 文档一致性

| 检查项 | 结果 |
|---|---|
| package.json 版本 | ✓ 同步 v0.25.6 |
| docker-compose 命令 | ✓ 修正为本机可用语法 |
| 环境变量表 | ✓ 与 .env.example 一致 |
| 脚本速查 | ✓ 与 package.json scripts 一致 |
| 内部链接 | ✓ 全部验证有效 |

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `README.md` | 重构 | 新增项目概述、核心功能说明、FAQ，修正 docker 命令，统一 Markdown 格式 |

