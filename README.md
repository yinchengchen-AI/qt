# 杭州企泰安全科技 业务管理系统 (qt-biz)

> 客户 / 合同 / 开票 / 回款 一体化管理，附件走 MinIO presigned 直传。
>
> **当前版本: v0.13.1**（2026-07-29）
>
> 项目文档地图见 [docs/README.md](docs/README.md)，详细设计见 [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md)，用户手册见 [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md)。

## 目录

- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [核心能力概览](#核心能力概览)
- [脚本速查](#脚本速查)
- [部署须知](#部署须知)
- [质量基线](#质量基线)
- [最近更新](#最近更新)
- [安全提醒](#安全提醒)
- [相关文档](#相关文档)

## 快速开始

需要 Node `>=20.9.0`，Docker（本地起 Postgres + MinIO）。

```bash
# 一键全流程：起 PG + MinIO + 装依赖 + 推库 + seed + 起 dev server
# 默认还会 seed 4 个 dev 测试账号 + 100 个 dev 客户；前台进程，Ctrl-C 退出
npm run dev:setup
```

如需手动分步（生产部署 / 自定义 seed）：

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
npm run seed:dev-users # 可选：4 个 dev 测试账号

# 5) 创建第一个业务管理员
npm run create-admin -- \
  --employeeNo admin \
  --name "系统管理员" \
  --email admin@example.com \
  --password 'Your-Strong-Pwd-2026'

# 6) 起服务
npm run dev            # http://localhost:3000
```

### 测试账号（dev 快速填充卡）

登录页右下角"测试账号"卡列出 4 个角色账号；`seed:dev-users` 还会建 `expert` 共 5 个，密码统一从 `DEV_QUICK_FILL_PASSWORD`（默认 `dev-only-fill`）读，只供 dev/test 用。

```bash
npm run seed:dev-users
```

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js (App Router + RSC + Server Actions) | 16.2.7 |
| 运行时 | React | 19.2.7 |
| 语言 | TypeScript (`strict` + `noUncheckedIndexedAccess`) | 6.0.3 |
| UI | Ant Design + @ant-design/pro-components | 6.4.3 / 3.1.12-0 |
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

完整版本矩阵与兼容性说明见 [docs/architecture/DESIGN-v3.md §1](docs/architecture/DESIGN-v3.md)。

## 项目结构

```
app/                       Next.js App Router（页面 + Route Handlers）
  (app)/                   已登录布局（Sider + Header + Content）
    dashboard/             工作台
    customers/             客户管理
    contracts/             合同管理
    invoices/              开票管理
    payments/              回款管理
    statistics/            统计分析（总览/账龄/业绩/Top）
    admin/                 系统管理（用户/角色/部门/字典/审计）
    messages/              消息中心
    announcements/         公告
  api/                     Route Handlers
  login/                   登录页
components/                共享 UI（admin/customers/file/form/...）
lib/                       客户端逻辑（auth/permissions/validators/i18n/...）
server/                    后端服务层（services/events/jobs/storage/audit）
prisma/                    schema.prisma + seed + migrations/
tests/                     Vitest（unit + api）+ Playwright（e2e）
docs/                      设计 / 评审 / 手册 / 部署
ops/                       运维脚本
scripts/                   dev/prod/migrate/shared CLI
docker-compose.postgres.yml
docker-compose.minio.yml
```

## 核心能力概览

README 只保留入口说明，详细设计请戳对应文档：

| 主题 | 说明 | 详情 |
|---|---|---|
| 业务模块 | 客户 / 合同 / 开票 / 回款 / 消息 / 公告 / 统计分析 | [DESIGN-v3.md §4–§5](docs/architecture/DESIGN-v3.md) |
| 状态机 | Contract、Invoice、Payment 显式状态机 + 自动转换 | [DESIGN-v3.md §5](docs/architecture/DESIGN-v3.md) |
| 跨模块校验 | R-01 ~ R-16 业务不变量（金额、唯一性、并发安全等） | [DESIGN-v3.md §6](docs/architecture/DESIGN-v3.md) |
| 认证 & 权限 | NextAuth v4 + JWT；5 角色 RBAC + SALES/EXPERT 行级隔离 | [DESIGN-v3.md §8](docs/architecture/DESIGN-v3.md) |
| 附件存储 | MinIO presigned PUT/GET 直传，MIME 白名单 + 软删除 | [DESIGN-v3.md §9](docs/architecture/DESIGN-v3.md) |
| 消息与通知 | 领域事件 → 站内信；邮件/企微通道已下线 | [DESIGN-v3.md §7](docs/architecture/DESIGN-v3.md) |
| 定时任务 | 5 个 cron job，统一走 `/api/jobs/run-all` | [DESIGN-v3.md §10](docs/architecture/DESIGN-v3.md) / [ops/README.md](ops/README.md) |
| 统计分析 | 总览 / 账龄 / 业绩 / Top 客户 / xlsx 导出 | [DESIGN-v3.md §8](docs/architecture/DESIGN-v3.md) / [USER_MANUAL.md §11](docs/user/USER_MANUAL.md) |
| 移动端适配 | Antd 断点 + ProTable/ProDescriptions/Drawer 响应式 | [DESIGN-v3.md](docs/architecture/DESIGN-v3.md) |

## 脚本速查

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run dev:setup` | 一键起 Postgres + MinIO + 装依赖 |
| `npm run dev:up` / `dev:down` | 仅 Docker 生命周期 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run typecheck` | TS 类型检查 |
| `npm run lint` / `lint:fix` | ESLint（0 warnings） |
| `npm test` | 单元 + API 测试（Vitest） |
| `npm run test:e2e` | E2E（Playwright） |
| `npm run prisma:migrate` | 创建/应用 migration |
| `npm run prisma:deploy` | 生产应用 migration |
| `npm run prisma:studio` | Prisma Studio |
| `npm run seed` | 系统管理 seed（角色/部门/字典/工作流模板） |
| `npm run seed-roles` | 只插 5 角色 |
| `npm run seed-dicts` | 只插 8 类字典 |
| `npm run create-admin` | CLI 创建账号 |
| `npm run seed:dev-users` | dev 专用，幂等 upsert 5 个测试账号 |
| `npm run reset-password` | 重置密码 |
| `npm run loadtest` | 压测（默认 50 并发 × 5s） |

完整 scripts 见 [package.json](package.json)。

## 部署须知

### 环境变量

```env
DATABASE_URL="postgresql://qitai:qitai_pass@localhost:5432/qt_biz?schema=public"
NEXTAUTH_SECRET="..."          # 至少 32 字符
NEXTAUTH_URL="https://app.example.com"
APP_ENC_KEY_HEX="..."          # 32 字节 hex = 64 字符（AES-256-GCM 加密敏感字段）
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
npm run seed       # 此时找到 ADMIN，写入工作流模板
```

**生产密码**：`create-admin` 强制 ≥ 8 字符，生产请用密码管理器生成的随机串。

### 阿里云 ECS 单主机部署

详见 [docs/ops/deploy-ecs.md](docs/ops/deploy-ecs.md) 和 [ops/](ops/)。

### 备份与定时任务

- **本地 cron**：`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**：`vercel.json` 已配 `POST /api/jobs/run-all` 每日 01:00 UTC
- **Cron Secret**：Vercel Cron 自动注入 `Authorization: Bearer <CRON_SECRET>` 鉴权

### 502 友好页

nginx 反代下上游异常时，由 `public/502.html` 静态页和 `app/502/page.tsx` 动态页两层兜底。完整配置见 [ops/nginx/qt-biz.conf](ops/nginx/qt-biz.conf)。

## 质量基线

基线刷新于 **v0.13.0（2026-07-29）**。

| 项 | 状态 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 81 个 .test.ts 文件，622 用例全绿 |
| `npm run test:e2e` | 部分运行：01.1 / 12 / 14 三项目（chromium / iPad / iPhone）全绿 |
| `prisma generate` + `migrate deploy` | 42/42 migrations，client v7.8.0 |
| `npm run build` | 本地因 `docker-data/postgres` 目录权限未通过验证（环境限制，非代码错误） |

## 最近更新

完整 changelog 见 [CHANGELOG.md](CHANGELOG.md)。

### v0.13.1（2026-07-29）编辑开票页合同编号显示修复

编辑开票页「合同编号」误显示 contractId(cuid):`getInvoice` 平铺返回合同 `contractNo` 修复。无 schema 变更，无 API 契约变更。

### v0.13.0（2026-07-29）员工档案每步独立保存 + 前端修复 + 开票税号放宽

员工档案向导每步可「保存本步」单独提交（profile 按步切片、子表按步替换），后端乐观锁覆盖子表单保存，连续保存不误报 409；修复省市区级联受控失效、详情页重置密码空实现、头像不回显、null 泄漏必 400 等一批档案前端 bug；确认开票移除「公司抬头必填税号」拦截（R-09 仅保留电子发票号 20 位）；e2e 套件对齐登录页改版（16 个 spec 57 处选择器）。无 schema 变更，无 API 契约变更。

### v0.12.0（2026-07-28）前端移动端适配强化

对管理后台多个页面进行移动端/窄屏适配：ProDescriptions 响应式列数、ProTable 补齐 `scroll.x` / `sticky` / 小屏分页、Modal/Drawer 响应式宽度、权限矩阵窄屏优化、工作台极窄屏隐藏权限提示。无 schema 变更，无 API 契约变更。

### v0.11.0（2026-07-24）合同 / 开票 / 回款 全模块逻辑审查修复

对三个核心模块做完整代码逻辑审查并修复 24 项确认问题：P0 功能失效 4 项、P1 数据一致性 / 业务漏洞 12 项、P2/P3 不一致与健壮性问题若干。新增 24 个回归测试。含 2 个新 migration，部署时需执行 `npm run prisma:deploy`。

### v0.10.6（2026-07-23）客户列表「来源」列替换为「联系人」列

客户管理列表不再展示「来源」，改为展示主联系人，与导出 Excel、详情 PDF 口径一致。纯前端列调整，无 schema 变更、无 API 契约变更。

## 安全提醒

- **不要**提交 `.env`、`docker-data/`、`backups/`
- 上传/下载走 Next.js 代理，MinIO 留在 `:9000` 内网，不公网暴露
- `npm run seed` 仅系统管理数据；生产种子在干净环境手动跑，不随例行更新跑
- dev 默认账号（`minioadmin/minioadmin`、`postgres/postgres`）仅本地用，生产前必须轮换

## 相关文档

| 文档 | 用途 |
|---|---|
| [docs/README.md](docs/README.md) | 文档地图与阅读指南 |
| [docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md) | 完整设计（v3，版本矩阵钉版） |
| [docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md) | 用户手册 |
| [CHANGELOG.md](CHANGELOG.md) | 完整版本历史 |
| [docs/reference/project-summary.md](docs/reference/project-summary.md) | 项目总结 |
| [docs/history/code-review/code-review.md](docs/history/code-review/code-review.md) | 上线前代码审查 |
| [docs/history/code-review/phase-review.md](docs/history/code-review/phase-review.md) | P2 / P3 阶段验收报告 |
| [docs/architecture/RLS.md](docs/architecture/RLS.md) | RLS 策略 |
| [docs/history/test-reports/playwright-e2e-report.md](docs/history/test-reports/playwright-e2e-report.md) | Playwright E2E 报告 |
| [docs/ops/dictionary-maintenance.md](docs/ops/dictionary-maintenance.md) | 数据字典维护 |
| [ops/README.md](ops/README.md) | 运维脚本说明 |
| [scripts/README.md](scripts/README.md) | 脚本说明 |
