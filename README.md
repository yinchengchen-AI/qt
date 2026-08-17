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
> **当前版本: v0.19.0**(2026-08-14)。文档地图见 [docs/README.md](docs/README.md),架构与设计见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md),用户手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

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

### v0.20.0(2026-08-20)发票与回款自动对账匹配

新增对账中心模块：银行流水导入、多维度自动匹配引擎、差异处理与对账确认全流程。**DB schema 有变化：新增 `BankTransaction`/`ReconciliationRule`/`ReconciliationDiscrepancy` 3 张表（迁移 `20260820_bank_reconciliation`，含 `GRANT ALL ... TO qt_app`）**。

- **feat(reconciliation)**：银行流水 Excel/CSV 导入（`POST /api/reconciliation/import`），支持中文字段映射、同批次去重、跨批次唯一约束防重复
- **feat(reconciliation)**：多维度自动匹配引擎（金额 40% / 日期 20% / 客户名 25% / 摘要关键词 15% / 历史模式 5%），高置信度（≥80 分且领先第二名 ≥20 分）自动匹配，中置信度（60-79 分）标记建议
- **feat(reconciliation)**：对账中心页面 `/payments/reconciliation` — 统计卡片、流水列表（筛选/分页）、详情 Drawer（候选匹配列表）、批量自动匹配、差异处理标记
- **feat(reconciliation)**：匹配操作 API — 自动匹配 / 确认匹配（更新 Payment 流水号+状态） / 手动匹配 / 取消匹配 / 忽略流水
- **feat(reconciliation)**：差异记录（`ReconciliationDiscrepancy`）— 金额不符自动检测，支持标记处理
- **feat(permissions)**：新增 `RECONCILIATION` 资源权限 — ADMIN/FINANCE CRUD+导出，SALES/OPS/EXPERT 只读
- **feat(messages)**：新增 4 类对账消息 — `RECONCILIATION_AUTO_MATCHED` / `RECONCILIATION_SUGGESTION` / `RECONCILIATION_DISCREPANCY` / `RECONCILIATION_WEEKLY_REPORT`
- **测试**：新增 `tests/api/reconciliation.test.ts` 20 用例（解析/导入/匹配/操作/查询/权限）;typecheck / lint / vitest 全绿（97 文件，795 用例）

### v0.19.9(2026-08-17)账龄分析明细列表翻页失效修复

明细分页的 page/pageSize 只存在组件本地 state、从未进查询串(恒拉第 1 页),翻页点击无效;提升到页面层进 `/api/statistics/invoice-aging` 参数,filter 变化自动重置页码。**DB schema 无变化**。

### v0.19.8(2026-08-17)CI 修复:seed 前补 prisma generate

fresh node_modules 的 `@prisma/client` 未生成 client 导致 seed 报错,test job 迁移前补显式 generate;迁移 resolve 路径与 build job 已验证通过。**DB schema 无变化**,纯 CI 配置无需部署。

### v0.19.7(2026-08-17)CI 修复:fresh DB 迁移重放雷区自动化 + 测试 fixture 自愈

CI 首跑抓到两个 fresh DB 限定问题:迁移重放撞 20260630 已知雷区(封装 `scripts/shared/migrate-deploy.sh` 自动 resolve,dev:setup 同入口,弃用 migrate dev)、测试依赖环境已有客户(改为自建 fixture)。scratch PG 全新库彩排 775/775 全绿。**DB schema 无变化**,不影响运行时无需部署。

### v0.19.6(2026-08-17)CI 门禁上线 + CHANGELOG 草稿半自动化

GitHub Actions 每次 push/PR 自动跑真实 PG(迁移+seed)上的 lint/typecheck/vitest + 生产构建冒烟;`npm run changelog:draft` 从 commits 生成 CHANGELOG 草稿(自动检测迁移改动预填 DB 行)。**DB schema 无变化**,不影响运行时无需部署。

### v0.19.5(2026-08-17)移除失效的 eslint-disable 指令

eslint 9.18→9.39.5 后 `declare global` 中的 `var` 不再触发 `no-var`,删除 `scheduler.ts` 失效的 eslint-disable 注释(否则报未使用指令 warning)。**DB schema 无变化**,注释类改动无需部署。

### v0.19.4(2026-08-16)聚合搜索框移至内容区 sticky 吸附条

搜索框从顶栏右侧移至内容区顶部,sticky 吸附随页面滚动始终可见;居中限宽 720px,手机端直显输入框。**DB schema 无变化**。

- **feat**:Content 顶部 sticky 搜索条(top=Header 高度,实色背景遮挡);顶栏右侧只留消息+头像
- **feat**:GlobalSearch 新增 block 全宽模式;手机端不再走"图标→展开"两步流程,隐藏无意义的 Ctrl K 徽标
- **test(e2e)**:登录 timeout 放宽(dev 编译压力容错);三项目 e2e 全过;sticky 滚动截图验证

### v0.18.9(2026-08-14)工作台客户区域分布柱状图视觉打磨

工作台「客户区域分布」柱状图视觉打磨:去彩虹色与巨型图例,改单色;按数量聚合 Top 10 + 其他,未录入镇街标「未录入」,x 轴标签防重叠。**DB schema 无变化**。

- **单色替代彩虹**:去掉 `colorField="town"` 几十项图例,改用品牌主色 + `legend: false`
- **Top 10 + 其他**:后端 `townDistribution` 已按数量降序,前端聚合前 10 与「其他」,空镇街标「未录入」
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

### v0.18.8(2026-08-14)合同详情页操作记录动作中文标签 + 语义色

合同详情页「操作记录」时间线 + 点击节点打开的详情抽屉,动作标识从英文原始码统一改为中文标签 + 语义色 Tag(正向绿 / 负向红 / 进行中蓝 / 待定橙 / 中性灰)。**DB schema 无变化**。

- **合同操作记录中文标签**:`operation-timeline.tsx` 与 `operation-log-drawer.tsx` 动作改用 `<Tag color={shortActionTone(action)}>{shortActionLabel(action)}</Tag>`
- **`lib/operation-log-format.ts` 重构**:`ACTION_LABELS` 升级为 `ACTION_META`(label + tone 语义色),新增 `shortActionTone()`
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

### v0.18.7(2026-08-14)消息中心前端显示优化 (Wave 2)

消息中心前端打磨:抽屉补齐「加载更多」与「置顶公告」,类型标签统一为 StatusTag,消息页合并标题/内容冗余列,单条已读后不再跳回第 1 页。**DB schema 无变化**。

- **抽屉加载更多**:补齐分页,带 loading 态
- **抽屉置顶公告**:打开抽屉 / 收到推送时拉取并展示 pinned 公告
- **消息页合并冗余列**:标题 + 内容 + 详情气泡 → 单一「消息」列(标题加粗 + 内容两行截断预览)
- **类型标签统一**:抽屉改用 `<StatusTag domain="message">`,与消息页一致
- **单条已读保留分页**:标记已读 / 删除 / 清空不再 `reloadAndRest` 跳页

### v0.18.5(2026-08-13)行级隔离前端收口 (Wave 3)

页面层对齐行级隔离:非管理员查看/编辑他人数据的入口全部按 owner 判定,直接访问 URL 也有 403/降级兜底。**DB schema 无变化**。

- **客户/合同/发票编辑入口 owner 判定**:详情页编辑按钮仅本人(SALES/EXPERT)可见,编辑页直接访问兜底
- **发票/回款新建合同选择器过滤**:只列本人负责的合同
- **员工档案 403 降级**:无权查看他人档案时显示基本联系卡,敏感区仅 ADMIN 可见
- **证书到期页 OPS 门禁**:仅 ADMIN / OPS 可查看

### v0.18.4(2026-08-11)全局搜索

新增全局搜索功能，支持跨客户/合同/发票/回款快速检索。

- **触发方式**:Header 右侧搜索图标 + `Cmd+K` / `Ctrl+K` 快捷键
- **搜索范围**:客户(名称/编号/联系人/电话)、合同(合同号/标题/客户名)、发票(发票号/代码/客户名)、回款(回款号/流水号/客户名)
- **实时搜索**:300ms 防抖，按实体类型分组展示，键盘导航(↑↓ / Enter / Esc)
- **权限控制**:RBAC + 行级隔离(SALES/EXPERT 只能搜自己负责的数据)

### v0.18.3(2026-08-02)ADMIN 可直接调整角色权限 (运行时真源翻到 DB)

把运行时权限真源从 `lib/permissions.ts` 硬编码矩阵翻到 DB `Role.permissions`,admin 在 `/admin/roles` 直接编辑 (含系统角色),保存后 ≤2s 全员生效. 完整动机 / 安全护栏 / 缓存失效策略见 [CHANGELOG.md](CHANGELOG.md) v0.18.3 段.

- **`lib/permissions.ts`**: 新增 `runtimePermissions` 进程级缓存; `hasPermission` / `requirePermission` 先查缓存, 兜底查 `ROLE_PERMISSIONS`. 现有 173 处调用零改动.
- **`lib/auth.ts`**: `session` callback 每次请求 `loadRolePermissions(roleCode)` 从 DB 拉 (2s TTL), 灌进 `runtimePermissions` + `session.user.permissions`.
- **`server/services/role.ts#updateRole`**: 放开系统角色编辑; 加 **ADMIN 锁死护栏** (ADMIN 必须保留 [角色] 资源的读+改, 否则后续无人能调回) + 空权限 400 + code 改名冲突 409 + 系统角色 code 改名超 RoleCode 联合 400.
- **缓存失效**: `updateRole` 改权限 / code → `User.roleVersion + 1` (全员) + `invalidateAuthCache(uid)` + `setRuntimePermissions(newCode, newPerms)`.
- **新页面** `/admin/roles/[id]/edit`: 名称/说明/权限矩阵受控编辑, dirty 检测 + ADMIN 锁死护栏前端兜底, 保存 → 详情页.
- **测试**: `tests/unit/server/role-update.test.ts` (15 条) + `tests/permissions-runtime.test.ts` (7 条); 全量 683/683 绿; dev server + curl E2E 跑通 (admin PATCH → sales 重登看到新权限 → restore → 护栏 403).
- **`createRole` 仍 403**: 自定义角色另行单独做, 不是本次范围.
- **DB schema / migrations**: 无变化 (纯运行时逻辑).

### v0.18.2(2026-08-02)修复 deploy.sh 的 npm ci devDeps 漏装

v0.18.1 首次部署定位与修复: 服务器 `.env` 把 `NODE_ENV=production` 注入 npm ci, npm 自动 omit=dev, prisma / tsx / vitest 等 devDeps 全跳过, `npx prisma` 临时下载又找不到 `prisma/config`。

- `scripts/prod/deploy.sh`: `npm ci` 前 `unset NODE_ENV`、完后 `export` 回去, 保 Next runtime 的 production 语义
- 不动 `.env` / `.npmrc` (NODE_ENV=production 是 Next + systemd 的运行时配置)
- 验证: 服务器重跑 `npm ci` 后 prisma generate 通过, typecheck / lint / test 全绿

### v0.18.1(2026-08-02)权限细化 + 数据字典只读/拒写

v0.18.0 权限收紧的延伸 — EXPERT/OPS 行级再细一刀, 字典 9 类枚举约束只读 + service 拒写, 修复 `refreshDict` 不生效等 4 个字典 bug, 字典种子双源并一.

- **EXPERT 行级收紧**: PAYMENT `CR+导出` → `R+导出`, DUNNING `CR` → `R` (钱相关只读, 商业动作归 SALES)
- **OPS 行级收紧**: CUSTOMER `CRU+导出` → `R+导出` (客户资料 owner 是销售)
- **`/admin/roles` 只读化**: service 拒写系统角色, 列表页加 Alert 说明运行时真源是 `lib/permissions.ts`, 删两个编辑子页面
- **字典 9 类只读**: CUSTOMER_TYPE/SCALE/CONTRACT_PAYMENT_METHOD/INVOICE_TYPE/PAYMENT_RECEIVE_METHOD/REVIEW_ACTION/CONTRACT_STATUS/INVOICE_STATUS/PAYMENT_STATUS 的 code 由 zod 枚举或状态机硬约束, 字典页只读展示 + service 拒写 (403)
- **`refreshDict` 真正生效**: SWR `mutate` 替代死代码 `subs/notify`, admin 写后同标签页其他页面下拉即时刷新 (跨标签页不广播, 已知限制)
- **字典种子双源合一**: 新增唯一定义源 `scripts/shared/dict-defs.ts`, 消除 seed.ts 与 seed-dicts.ts 的 SERVICE_TYPE label 漂移, 移除已下线的 CUSTOMER_STATUS / PROJECT_STATUS
- **code 正则放宽**: 字典 code 允许点号 (匹配存量树形 code 如 `R2.30`)
- **DB schema**: 无变化 (纯 role 矩阵细化 + 字典旁路拒绝 + 文档同步)

### v0.18.0(2026-08-02)非 ADMIN 权限矩阵重排 + 三处 service 守门加固

非 ADMIN 四个角色的权限做了重新分配, 同时 3 处 service 入口补强 (避免菜单绕过). 详见 `docs/history/security/permissions-audit-2026-08-02.md`.

- DUNNING (催收): SALES / EXPERT 从 CRUD 降为 CR; FINANCE 从 CRU 升为 CRUD
- EXPERT.INVOICE: 从 CRU+导出 降为 R+导出
- 回收站 (trash): service 入口硬卡 ADMIN
- 公告 (announcement): update / delete 限制发布人或 ADMIN

### v0.17.1(2026-08-02)全链路标 DEPRECATED(应急 docker fallback 路径)

v0.17.0 仅清掉了镜像与 `rollback.sh --docker` flag, 文档/代码里仍有引用。v0.17.1 统一补 `**DEPRECATED**` 标签, 行为不变。

- `Dockerfile` / `docker-compose.prod.yml` / `deploy.sh:62` / `rollback.sh:33` / `remote-deploy.sh:32` 顶部加 `~~~~~~~~~~~~~~~~~~~~ DEPRECATED ~~~~~~~~~~~~~~~~~~~~` banner
- `AGENTS.md` / `README.md` / `docs/ops/deploy-current.md` 同步加 `**DEPRECATED**` 标记
- 历史档案 (`CHANGELOG.md` v0.16 及更早, `docs/ops/deploy-history/*.md`) **不动**

### v0.16.0(2026-08-02)部署提速:native systemd 主路径,14min → 秒级

**单次部署从 ~14 分钟压到 30s–2min**,架构变化:

- **App 切 native systemd**:qt-app 走 `qt-app.service`(`node node_modules/next/dist/bin/next start`),不再每部署 docker build
- **关键加速**: `.next/cache` 持久化后 Turbopack 增量复用,改动小秒级,大改 1–2min;`npm ci` 仅在 lockfile/patches/prisma 变化时跑(常规部署 0s)
- **postgres / minio 仍 docker**:数据卷( `/opt/qt/docker-data/` )继续走容器,不重 init
- **`scripts/prod/switch-to-native.sh`** 一键从 docker qt-app 切到 native:停容器 → enable systemd → smoke test → 备份原 compose
- **`scripts/prod/rollback.sh --docker`** (**DEPRECATED**): 应急入口已移除 — qt-app:latest 镜像已删, native 是唯一路径
- **AGENTS.md / docs/ops/deploy-current.md** 重写 deploy 流程说明

为什么换:3.5GB ECS 内存吃紧,dockerd 自占 1.7GB + hermes 0.5GB,build 阶段可用只剩 ~425MB,`next build` 直接 swap,14min。native 拿回 dockerd 占的 1.7GB + .next/cache 增量 ≈ 10× 提升。

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
