# qt-biz · 杭州企泰安全科技 业务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.12-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.7-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-3178c6)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.9.1-2d3748)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![Last Release](https://img.shields.io/badge/release-v0.19.0-blue)](CHANGELOG.md)
[![CI](https://github.com/yinchengchen-AI/qt/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yinchengchen-AI/qt/actions/workflows/ci.yml)

> **客户 / 合同 / 开票 / 回款** 一体化管理,附件走 MinIO presigned 直传,服务端 Server Actions + RBAC + 行级隔离。
>
> **当前版本: v0.21.2**(2026-08-19)。文档地图见 [docs/README.md](docs/README.md),架构与设计见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md),用户手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

## 目录

- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [脚本速查](#脚本速查)
- [部署须知](#部署须知)
- [质量基线](#质量基线)
- [最近更新](#最近更新)
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
# 1) 起基础设施
docker compose -f docker-compose.postgres.yml up -d
docker compose -f docker-compose.minio.yml   up -d

# 2) 环境变量
cp .env.example .env   # 默认 minioadmin/minioadmin;生产前必轮换

# 3) 依赖 + 数据库迁移
npm install
npx prisma migrate dev

# 4) 系统管理数据(5 角色 / 5 部门 / 8 类字典)
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
└─ Dockerfile                 多阶段构建(v0.13.3 起全 Docker 化部署)
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
| `npm run seed` | 系统管理数据(角色 / 部门 / 字典 / 工作流模板) |
| `npm run seed-roles` | 只插 5 角色 |
| `npm run seed-dicts` | 只插 8 类字典 |
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

## 部署须知

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
| `SKIP_ENV_VALIDATION` | 否 | 仅构建期(v0.13.3+,`Dockerfile` 设置) |
| `MINIO_*` | 否 | 端点 / 端口 / 凭证 / bucket / 公开 base URL,见 `.env.example` |
| `DEV_QUICK_FILL_PASSWORD` | 否 | `seed:dev-users` 测试账号密码,**生产不要设置** |

### 全新生产部署顺序

```bash
npx prisma migrate deploy           # 应用全部 migration(已合并到 main 不可删)
npm run seed-roles                 # 5 角色
npm run seed-dicts                 # 8 类字典
npm run create-admin -- --employeeNo <工号> --name <真名> --email <公司邮箱> --password '<强密码>'
npm run seed                       # 找到 ADMIN 后写入工作流模板
```

**生产密码**:`create-admin` 强制 ≥ 8 字符,生产请用密码管理器生成的随机串。

### 阿里云 ECS 单主机部署

- 当前流程:**[docs/ops/deploy-current.md](docs/ops/deploy-current.md)**(日常部署只看这一份)
- 历史复盘:`docs/ops/deploy-history/`
- 一键回滚:`bash scripts/prod/rollback.sh`(默认切到上一版,`--list` 看历史)
- 远端触发:`./scripts/prod/remote-deploy.sh`(本地 Mac 通过 `~/Downloads/QT.pem` 触发)

日常更新(服务器 `/opt/qt`):

```bash
sudo -E ./scripts/prod/deploy.sh      # preflight → git pull → docker build → migrate → release:publish → compose up → smoke
```

构建已做国内源提速(apk 阿里云 / npm npmmirror + BuildKit 缓存挂载 / 阿里云个人镜像加速器),普通部署 ~3 分钟,依赖升级类 ~9 分钟。日志写到 `/var/log/qt-deploy.log`。

### 备份与定时任务

- **本地 cron**:`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**:`vercel.json` 已配 `POST /api/jobs/run-all` 每日 01:00 UTC,自动用 `CRON_SECRET` 鉴权
- **cron 健康检查**:`docs/ops/deploy-current.md` 中 `cron-healthcheck` 段

### 502 友好页

nginx 反代下上游异常时,由 `public/502.html` 静态页与 `app/502/page.tsx` 动态页两层兜底。完整配置见 [ops/nginx/qt-biz.conf](ops/nginx/qt-biz.conf)。

## 质量基线

基线刷新于 **v0.18.3(2026-08-02)**。

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 86 个 `.test.ts`,661 用例全绿 |
| `npm run test:e2e` | 部分运行:01.1 / 12 / 14 三项目(chromium / iPad / iPhone)全绿 |
| `prisma generate` + `migrate deploy` | 42 / 42 migrations,client v7.9.1 |
| `npm run build` | 本地因 `docker-data/postgres` 目录权限未通过验证(环境限制,非代码错误) |

## 最近更新

最近 5 个版本,完整历史见 [CHANGELOG.md](CHANGELOG.md)。

### v0.21.2(2026-08-19)操作日志时间段选择与查询再优化

时间范围 RangePicker 内置 10 个预设（近 1 小时 ~ 本年）取代头部快捷按钮；时间/动作/对象列头排序（默认时间倒序）;keyword 新增命中对象可读名（合同号/客户名/发票号/回款号/用户名等）,CSV 导出同步生效。**DB schema 无变化**。

### v0.21.1(2026-08-19)框架内容页宽度提高 15%

桌面端框架内容区最大宽度由 1280px 提高到 1472px(+15%),移动端仍 100% 铺开。**DB schema 无变化**。

### v0.21.0(2026-08-19)操作日志前后端体验优化

操作日志模块升级：修复搜索区时间范围过滤不生效的 bug；列表行内展示关联对象可读名（合同号/客户名/发票号/回款号）并可跳详情；新增 `GET /api/operation-logs/meta` 动态过滤候选与 `keyword` 模糊搜索；操作人改可搜索下拉；失败原因悬停可见；diff 字段中文名 + 请求ID/IP 一键复制；CSV 导出自动翻页（上限 1000 行）；逻辑下沉 `server/services/operation-log.ts`。**DB schema 有变化：迁移 `20260822_operation_log_action_index`（action 索引）**。

### v0.20.3(2026-08-17)对账中心与开票/回款规则对齐修复

对账中心动态走查修复：MessageType PG enum 缺 4 个对账消息值导致通知全部静默丢失（补迁移）、对账确认绕过回款 R-10/R-11/R-12 金额校验与到账通知（重构为与回款模块同规则的共享 writeback）、对账确认终态改 RECONCILED 并支持 paymentPrevStatus 精确回滚、manualMatch 与 confirmMatch 写回对称、补发建议匹配/差异提醒通知、消息中心对账链接可跳转详情抽屉。**DB schema 有变化：迁移 `20260817_reconciliation_fixes`**。

### v0.20.2(2026-08-17)对账规则配置（ReconciliationRule）下线

删除从未接线的对账规则配置（引擎不读、无 UI 的死代码）：DROP 整表 + 删 CRUD API/service/validators。**DB schema 有变化：迁移 `20260821_drop_reconciliation_rule`**。

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
