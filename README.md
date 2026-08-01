# qt-biz · 杭州企泰安全科技 业务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.12-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.7-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-3178c6)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.9.1-2d3748)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![Last Release](https://img.shields.io/badge/release-v0.13.9-blue)](CHANGELOG.md)

> **客户 / 合同 / 开票 / 回款** 一体化管理,附件走 MinIO presigned 直传,服务端 Server Actions + RBAC + 行级隔离。
>
> **当前版本: v0.13.9**(2026-08-01)。文档地图见 [docs/README.md](docs/README.md),架构与设计见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md),用户手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

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

基线刷新于 **v0.13.9(2026-08-01)**。

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 81 个 `.test.ts`,623 用例全绿 |
| `npm run test:e2e` | 部分运行:01.1 / 12 / 14 三项目(chromium / iPad / iPhone)全绿 |
| `prisma generate` + `migrate deploy` | 42 / 42 migrations,client v7.9.1 |
| `npm run build` | 本地因 `docker-data/postgres` 目录权限未通过验证(环境限制,非代码错误) |

## 最近更新

最近 5 个版本,完整历史见 [CHANGELOG.md](CHANGELOG.md)。

### v0.17.0(2026-08-02)去掉 docker fallback,腾 1.49GB

**删除 `qt-app:latest` 镜像 + `rollback.sh --docker` 选项 + `switch-to-native.sh` 标记历史**。

- 不再维护 docker 应急回退能力 — native systemd 是唯一路径
- 服务器仅留 postgres + minio 两个 active 容器
- 总盘从 16G 剩 → **21G 剩**
- 未来真要 docker 回退: `docker build . -t qt-app:latest && docker compose up -d app`

### v0.16.0(2026-08-02)部署提速:native systemd 主路径,14min → 秒级

**单次部署从 ~14 分钟压到 30s–2min**,架构变化:

- **App 切 native systemd**:qt-app 走 `qt-app.service`(`node node_modules/next/dist/bin/next start`),不再每部署 docker build
- **关键加速**: `.next/cache` 持久化后 Turbopack 增量复用,改动小秒级,大改 1–2min;`npm ci` 仅在 lockfile/patches/prisma 变化时跑(常规部署 0s)
- **postgres / minio 仍 docker**:数据卷( `/opt/qt/docker-data/` )继续走容器,不重 init
- **`scripts/prod/switch-to-native.sh`** 一键从 docker qt-app 切到 native:停容器 → enable systemd → smoke test → 备份原 compose
- **`scripts/prod/rollback.sh --docker`** 应急:systemd 炸了用 `qt-app:latest`(保留最近 1 版 docker 镜像做兜底)
- **AGENTS.md / docs/ops/deploy-current.md** 重写 deploy 流程说明

为什么换:3.5GB ECS 内存吃紧,dockerd 自占 1.7GB + hermes 0.5GB,build 阶段可用只剩 ~425MB,`next build` 直接 swap,14min。native 拿回 dockerd 占的 1.7GB + .next/cache 增量 ≈ 10× 提升。

### v0.15.0(2026-08-01)强制单点登录:不允许同账号多设备同时在线

- **User 加 `sessionVersion` 字段** + 登录时 +1, JWT 携带; **新登录踢掉所有旧设备**(同账号无法同时多端登录)
- **Admin 主动踢人**:员工详情页"踢出所有设备"按钮 + audit 留痕
- **渐进式动迁**:只影响 deploy 后新登录,旧会话不受打扰
- **前端提示**:被踢后跳到 `/login` 显示"您的账号在另一台设备登录,已自动登出"
- **不增加 DB 请求数**:沿用现有 2s 缓存机制,多查 1 列(单 SQL)

### v0.14.0(2026-08-01)消息中心全面优化:行级去重 + 归档表 + SSE 实时通知

4 个 PR 一气呵成:

- **PR 1 — UI 微调**:Bell badge `overflowCount={99}` 避免 4 位数压力;i18n 系统升级支持 `{n}` 占位符;toast 改用 `t("messages.toast.markedRead", { n })`
- **PR 2 — 行级去重 + 清空已读**:Message 表加 `entityKey` + `@@unique([entityKey, receiverUserId])` + `createMany({ skipDuplicates: true })`;5 个 emit caller 显式传 entityKey;新 `clearReadMessages` + `/api/messages/read/clear` API + PageHeader"清空已读"按钮(migration 一次性 backfill 4482 条历史,zero 重复)
- **PR 3 — 归档表 + admin 查看页**:新 `MessageArchive` 表 (append-only);`runMessageArchive` 90d cron 搬已读老消息(env `MESSAGE_ARCHIVE_AFTER_DAYS` 覆盖);`/admin/messages` ADMIN 专属只读页 + 月份过滤
- **PR 4 — SSE 实时通知**:新 `/api/messages/stream` 端点(25s 心跳, maxDuration=3600s);进程内 hub + 5s `kick` scheduler 把通知延迟从 60s polling 压到 ≤5s;前端 `useMessageStream` EventSource hook;nginx 加 SSE location 块(`proxy_buffering off` 等);60s polling 保留作为 EventSource 失败的兜底

质量基线:typecheck 0 / lint 0 / **test 83 files / 639 tests 全过**(新增 11 用例);部署注意:服务器 `sudo cp ops/nginx/qt-biz.conf /etc/nginx/conf.d/qt-biz.conf && sudo nginx -t && sudo systemctl reload nginx` 让 SSE 块生效

### v0.13.9(2026-08-01)KPI 口径说明 + 全站 tooltip/subtitle 批量校正

KPI 标题 ⓘ 口径与 `server/services/statistics.ts` 实际实现对齐(合同 / 开票 / 回款 / 客户的过滤条件、日期字段、状态 enum 全部注明);账龄 KPI 补 `dueDate` fallback + 应收计算公式。全站额外 9 处 tooltip/subtitle 批量校对,删除 v0.5.0 客户状态机、v0.3.0 项目/工作流模块等遗留错误描述。**纯 UI 文案,无 schema / API 契约变更**。

### v0.13.8(2026-08-01)部署链路优化:远端触发 + preflight + 一键回滚

`scripts/prod/_lib.sh` 抽出公共 `log / preflight_check / smoke_test`;`deploy.sh` 加 preflight(`.env` 8 个关键 key / git 干净 / 磁盘 ≥ 3G / 内存预警 / 容器健康),持久化日志 `/var/log/qt-deploy.log`;新增 `scripts/prod/remote-deploy.sh` 从本地 Mac 一键触发远端 deploy;新增 `scripts/prod/rollback.sh` 默认切到上一版(`--list` / `--to v0.13.6` / `--skip-smoke`),smoke 失败自动回滚。原 2077 行 `docs/ops/deploy-ecs.md` 拆为 `deploy-current.md` + `deploy-history/`。

### v0.13.7(2026-07-31)合同编辑支持管理员变更签订人 + 依赖升级

合同编辑页新增「签订人」字段:管理员可搜索改为任意在职员工(代录修正),非 admin 只读展示;服务端与负责人变更同口径(非 admin 变更 422、目标员工非 ACTIVE 400),变更纳入合同更新审计 diff。依赖升级:next 16.2.12 / prisma 7.9.1 / eslint 9.39.5 等。

### v0.13.6(2026-07-29)统计分析 4 页视觉 + 布局改版

综合看板移除与工作台重复的区域分布图;区域统计删除常驻 Alert;KPI 全面接入图标与开票率/回款率进度条;账龄分析筛选卡默认折叠;员工业绩 4 个同构柱状图合并为单图 + Segmented 切换指标。**无 API / schema 变更**。

### v0.13.5(2026-07-29)工作台视觉 + 布局改版

Dashboard 改版:月/季/年切换移入页头右侧;KPI 卡加图标与底部细进度条(`StatGrid` 新增可选 `icon` / `progress`);新增「待办预警」条(待开票 / 90+ 账龄 / 催收中 / 法务介入);镇街分布降为 16 栏,合同状态改 donut,开票/回款概况 12/12 分栏加金额占比细条,Top 客户加占比条形背景,账龄 90+ 红框强化。**数据获取与 API 不变**。

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
