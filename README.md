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
npm run seed                # 写入 5 角色 / 5 部门 / 字典 / 9 类工作流模板(系统管理数据)
```

### 3. 创建初始管理员

seed 不再写入任何业务账号,需要手动创建第一个管理员:

```bash
npm run create-admin -- \
  --employeeNo admin \
  --name "系统管理员" \
  --email admin@example.com \
  --password 'Your-Strong-Pwd-2026'   # 至少 8 字符
```

忘记密码可重置:`tsx scripts/shared/reset-password.ts --employeeNo <id> --password <newPwd>`。

### 4. 起服务

```bash
npm run dev
# 打开 http://localhost:3000,用工号 + 上面设的密码登录
```

## 种子数据策略

`prisma/seed.ts` 只插**系统管理数据**,业务数据**不**进 seed,生产环境使用真实数据。

| 类别 | 是否 seed | 备注 |
|---|---|---|
| 角色(Role)5 条 | ✅ | `ADMIN / SALES / FINANCE / OPS / EXPERT`,含 `lib/permissions` 全量权限位 |
| 部门(Department)5 条 | ✅ | 业务/技术/财务 + 技术部下两个子组 |
| 数据字典(Dictionary)~ 60 条 | ✅ | `SERVICE_TYPE / CUSTOMER_TYPE / CUSTOMER_SCALE / CUSTOMER_INDUSTRY / CUSTOMER_SOURCE / PAYMENT_RECEIVE_METHOD / FOLLOW_METHOD / FOLLOW_RESULT` |
| 工作流模板(WorkflowTemplate)9 份 | ✅ | 9 类服务 × 5 阶段(PREP/REQ/CONTRACT/EXECUTE/FOLLOWUP),需库内有 ADMIN 用户才会写入 |
| 用户 / 客户 / 合同 / 项目 / 发票 / 回款 / 跟进 / 联系人 | ❌ | 生产真实数据,本/测/线一致地走 UI / API / 导入 |
| 公告 / 站内信 | ❌ | 同上 |

**生产部署顺序**

```bash
npx prisma migrate deploy
npm run seed-roles          # 5 角色(与 prisma/seed.ts 同源, 单脚本可独立跑)
npm run seed-dicts          # 8 类字典
npm run create-admin -- --employeeNo <真实工号> --name <真名> --email <公司邮箱> --password '<强密码>'
npm run seed                # 此时会找到 ADMIN, 写入 9 份工作流模板
```

> **生产密码**: 不再使用 README / 文档里写死的 `123456` 等弱密码。`create-admin` 强制 ≥ 8 字符,生产请用密码管理器生成的随机串。
>
> **Workflow 模板 locked 护栏**: seed 检测到 `WorkflowTaskInstance` 有非软删记录时,只更新模板 `name` / `description` 元数据,不会重建 stage / task(避免在跑的工作流丢历史)。

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
| `npm run seed` | 跑系统管理 seed(角色/部门/字典/工作流模板) |
| `npm run seed-roles` | 只插 5 角色(创建首个 admin 前用) |
| `npm run seed-dicts` | 只插 8 类字典 |
| `npm run create-admin` | CLI 创建账号,首登前必跑(`--employeeNo` / `--name` / `--email` / `--password` 必填) |

## 当前状态:v0.2.0(2026-06-12)移动端 + 自动登录 待发布

**核心模块**

- 客户 / 合同 / 项目 / 开票 / 回款 五大模块 CRUD + 状态机 + 16 条跨模块校验规则
- **工作流引擎**(项目级任务):模板按 serviceType 实例化 + 5 态状态机(PENDING/IN_PROGRESS/COMPLETED/SKIPPED/BLOCKED)+ 报告类二审(SUBMIT→APPROVE/REJECT)+ 交付物校验 + 阶段顺序锁定 + 循环任务(止期护栏)+ 时间感知循环生成(cron 入口);模板可视化编辑、跨版本 diff/迁移、Admin 概览/我的任务/超期/看板/JSON 导出
- 合同/发票附件走 MinIO(presigned 直传,不中转应用服务器)
- 消息中心(站内信 + 三通道通知:邮件/企微)
- 统计分析(总览 / 账龄 / 业绩)+ xlsx 导出
- 4 角色 RBAC(ADMIN/SALES/FINANCE/OPS)+ SALES 行级隔离
- 软删除 / 操作日志 / Cron 定时任务
- 登录页 + 顶部导航 重做(品牌 logo 配色、统计数字区、面包屑) 
- 部门管理(树形 CRUD + seed 关联 + user form 字段对齐)
- 行业 / 客户来源 / 部门 等数据字典(白名单 + `useDict` 接入)
- **移动端适配**:`<md` 折叠为汉堡 Drawer;列表 / 表单 / 详情 / 统计全场景自适应;`useResponsive` hook 统一断点(Antd 6 默认 xs/sm/md/lg/xl)
- **「7 天内自动登录」真正生效**:登录页复选框通过自定义 `jwt.encode` 拦截 maxAge 决定 JWT 寿命,勾选 → 7d,不勾选 → 8h

**质量基线(2026-06-13 重测)**

- `npm run typecheck` 0 errors
- `npm run lint` 0 errors / 19 warnings(react-hooks 等未启用规则已降噪,剩 19 个 `@typescript-eslint/no-unused-vars` / `no-explicit-any` 业务 warnings,不阻塞)
- `npm test` **142/142 通过**(6 个测试文件:`workflow` `permissions` `r17-gate` `recurring-cap` `storage-presign` `milestones-removed`)
- `npm run build` 成功
- dev server `/login` `/dashboard` `/contracts` 200

**生产硬化(2026-06-11 落盘)**

- **fix(forms)**:6 个表单页(`contracts/new` `contracts/[id]/edit` `invoices/new` `payments/new` `projects/new` `projects/[id]/edit`)修复 `</FormCard>` 早关导致 `SubmitBar` 漂在 `ProForm` 外的 JSX 嵌套错位;`build` 从"6 个页面解析失败"恢复到成功
- **fix(eslint)**:ESLint flat-config 修好(原本 `react-hooks/exhaustive-deps` 找不到 plugin,lint 直接抛 TypeError);`eslint.config.mjs` → `eslint.config.js`,降噪未启用的 `react-hooks/*` 规则
- **fix(next-env)**:Next 16 路径从 `.next/dev/types/routes.d.ts` 迁回 `.next/types/routes.d.ts`
- **fix(auth)**:生产环境 `useSecureCookies` 默认按 `FORCE_HTTPS` 决定,显式开启才走 Secure Cookie;非生产仍走 HTTP(适配反代)
- **fix(cron)**:`/api/jobs/run-all` 生产环境强制 `CRON_SECRET`,缺失时 500 告警并拒绝执行,杜绝误用
- **refactor(jobs)**:`runAllJobs` 预取 admin 列表一次,3 个 job 复用(N+1 → 1)
- **fix(statistics)**:账龄页 `buckets["90+"]` 在空桶时 `undefined > 0` 类型不安全,统一 `(buckets["90+"] ?? 0) > 0`
- **feat(components)**:`EmptyState.height` 支持直接传入数字(px);`StatGrid.columns` 新增 5 列档
- **docs(review)**:落盘 `docs/部署前代码审查 — qt-biz v0.1.0.md`,3 P0 阻断 + 4 P1 风险全部修复

## 最近更新

### v0.2.0(2026-06-22)合同状态机自动转换落地

- **feat(contract)**：三个 `tryAuto*` 钩子 + 合同过期定时任务
  - `tryAutoExecuteContract` / `tryAutoCompleteContract` 在 `projectAction` 同事务内调用，保证状态切换与项目动作原子提交
  - `tryAutoExpireContract` + `runContractExpiryJob` 每日 01:00 扫过期合同（`runAllJobs` 已接入）
  - 三类新消息：`CONTRACT_AUTO_EXECUTED` / `CONTRACT_AUTO_COMPLETED` / `CONTRACT_AUTO_EXPIRED`（合同 owner + 全部 ADMIN）
- **feat(schema)**：`User.isSystem Boolean @default(false)` + 迁移 `20260621_user_is_system` 创建 `system` 占位用户（不可登录）。自动转换的 actorId / reviewerId 统一写 `system`
- **fix(auth)**：`lib/auth.ts` 登录 / 加载用户、`server/events/bus.ts:listAdminUserIds`、`server/services/{asset-expiry-job,workflow}.ts` 通知接收人、`server/jobs/runner.ts` admin 列表 8 处补 `isSystem=false` 过滤，避免占位用户被当作真人
- **fix(contract)**：`softDeleteContract` 包成 Serializable + P2034 重试环（3 次），防 `count/update` 竞态
- **test**：`tests/api/contract-auto-transition.test.ts` 10 用例（`tryAutoExecute` / `tryAutoComplete` / `tryAutoExpire` / `runContractExpiryJob` 全覆盖），全部通过
- **chore(migrate)**：`scripts/migrate/cleanup-auto-transition-test.mjs` 一键回滚 E2E 验证副作用（合同状态复原 + 审计 / 消息清理），含 `--dry-run` / `--apply` 两种模式

质量：`tsc --noEmit` 0 错，`vitest run tests/api/contract-auto-transition.test.ts` 10/10。

### v0.2.0(2026-06-13)工作流引擎读路径收敛 + 修 reviewTask 死代码

- **refactor(workflow)**:抽 `lib/workflow-view.ts` 共享 helper(纯函数,无 prisma 依赖)。`computePhaseView(instances, { isPhaseBlocking?, isPartial? })` 集中了 `getProjectWorkflow` / `getProjectKanban` 共用的 phase 聚合 + 状态计算 + lockReason 文案:
  - `isPhaseBlocking` 默认 `requiredUnfinishedCount>0`(workflow 严格语义);kanban 传 `anyActive` 保留旧"任意 active 即阻塞"简化行为
  - `isPartial` 默认 `anyActive`(kanban 语义);workflow 显式传 `completed>0` 保留旧 `computePhaseStatesForProject` 行为(纯 PENDING phase 显 `READY` 而非 `PARTIAL`)
  - 空 phase 永远 `READY`,不被前序阻塞(与旧实现一致)
  - `WORKFLOW_PHASE_ORDER` 5 个 phase 都建条目,调用方无需默认兜底
  - `pickMajorityTemplateId(instances)` 给 `getProjectUpgradeCheck` / `exportProjectWorkflow` 共用,顺手把重复的 `WORKFLOW_PHASE_TO_CN` 映射也合并过来。删掉旧 `computePhaseStatesForProject` 私有函数(35 行,async 但 `_tx` / `_projectId` 参数无人使用)
- **fix(workflow)**: `reviewTask` 里"submit 校核通知项目负责人 + 管理员"的 `emit("WORKFLOW_REVIEW_REQUESTED")` 块原本写在 `return updated;` 之后,**死代码**——总线 / dispatcher 已注册但永远不触发。挪到 return 之前 + 调换 audit 顺序后,submit 会真正发通知
- **fix(workflow)**: `getTaskHistory` 把内联 SALES 行级隔离检查换成 `loadInstanceForUpdate`,与其他 service 一致(原内联检查不查合同 `deletedAt`,SALES 边界有偏差)
- **test(workflow)**: `tests/workflow.test.ts` +168 行,`computePhaseView` 8 用例(空 / 全完成 / 锁 / 不阻塞 / SKIPPED / kanban PARTIAL / kanban 阻塞非空后续 / byStatus)+ `pickMajorityTemplateId` 4 用例(空 / 多数 / 并列 / null 跳过),直接覆盖读路径行为

行为完全等价:`tsc --noEmit` 0 错,`vitest run` 142/142。`server/services/workflow.ts` 1678 → 1593 行,核心读路径逻辑从三处散落变成单一来源。

### v0.2.0(2026-06-12)移动端适配 + 自动登录(待发布)

- **feat(ui): 移动端适配** — `Pad 完整可用 / Phone 优雅降级`。Sider 在 `<md` 折叠为 Drawer(汉堡触发);5 列表页 + 5 详情页 + 3 统计页 + 2 抽屉 + 共享件(`Page` / `PageHeader` / `StatGrid` / `FormSection` / `FormCard` / `SubmitBar`)全部接入 `useResponsive`;`globals.css` 加 safe-area 工具类与 `:focus-visible` 轮廓;`layout.tsx` 新增 `viewport` 与 `themeColor` export。详情见本文「[移动端适配](#移动端适配)」章节
- **feat(auth): 「7 天内自动登录」真正生效** — 之前复选框是装饰;本轮在 `lib/auth.ts` 自定义 `jwt.encode`,按 `token.remember` 决定 `effectiveMaxAge`(true/缺省 → `session.maxAge=7d`,false → 8h)。`tests/e2e/auto-login.spec.ts` 用 jose 解密 JWE 断言两种情况下 `exp - iat`
- **chore(playwright)**:新增 `iphone-13` 与 `ipad-portrait` projects(独立 webkit,无 chrome 通道强制);新文件 `tests/e2e/responsive.spec.ts` 覆盖 Shell + 5 列表 + 1 表单的响应式 smoke

### v0.1.0(2026-06-11)生产硬化

- **fix(forms)**:6 个表单页 `</FormCard>` 早关导致 `SubmitBar` 漂出 `ProForm`,`build` 恢复
- **fix(eslint)**:flat-config `react-hooks` 找不到 plugin 修好,`eslint.config.mjs → eslint.config.js`
- **fix(auth)**:生产 `useSecureCookies` 按 `FORCE_HTTPS` 决定
- **fix(cron)**:`/api/jobs/run-all` 生产强制 `CRON_SECRET`,缺失 500 告警
- **refactor(jobs)**:admin 列表复用,N+1 → 1
- **fix(statistics)**:账龄页空桶 `buckets["90+"]` 兜底
- **feat(components)**:EmptyState 支持 px 数字高度,StatGrid 新增 5 列
- **chore(scripts)**:`generate-divisions.cjs` 加 `eslint-disable` 注释
- **fix(login)**:ticker 分隔符 `//` 字面量包起来,消歧义
- **docs(review)**:落盘 `docs/部署前代码审查 — qt-biz v0.1.0.md`

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

## 移动端适配

断点沿用 Antd 6 默认(`xs=480` / `sm=576` / `md=768` / `lg=992` / `xl=1200`),`md` 作为手机 / 平板分水岭。

**Shell 行为**

- `>=md` 桌面:左 232px 固定 Sider + 顶部 64px Header(原有行为)
- `<md` 手机:Sider 收起,顶栏左侧出现汉堡按钮;点击 → 左抽屉 Drawer(`min(320, 85vw)`),带遮罩;路由切换 / 菜单点击 / 遮罩点击自动关闭
- 头像 + 用户名 + 角色在 `<sm` 极窄屏隐藏,只保留头像(带 Tooltip)
- 面包屑在 `<sm` 只显示最后一段,避免挤爆 header

**业务页行为**

| 场景 | 行为 |
|---|---|
| 5 列表页 | ProTable 加 `scroll.x: max-content` + sticky 头,移动端搜索栏 `layout: vertical`、分页 `size: small`;首列 `fixed: left` 便于横滑 |
| 5 详情页 | `ProDescriptions.column` 改为 `{ xs:1, sm:1, md:2, lg:2, xl:3 }`;内嵌 ProTable 同样加 `scroll.x` + sticky |
| 5 新建/编辑页 | `FormGrid` 在 `<sm` 强制 1 列,`SubmitBar` 移动端块状按钮 + 贴底安全区 |
| 2 抽屉(跟进 / 进度) | `<md` 改 `placement: bottom`、`width: 100%`、`height: 90%`,符合拇指可达 |
| 3 统计页 | 图表 `autoFit` + 高度在 `<md` 压缩到 240px;业绩 / 账龄明细在手机端折叠到 Top 5 |
| 仪表盘 | 5 列 KPI 堆叠;Row/Col 在 `<md` 单列堆叠 |

**触摸与可达性**

- 重要按钮(`size="large"`)在 `<md` 强制 ≥ 40px 命中区
- 主体加 `.qt-touch` class(`<md` 命中),禁用菜单 hover-to-open 行为
- `:focus-visible` 沿用 Antd 主色键盘焦点环
- 移除 `-webkit-tap-highlight-color`,用 Antd 自带 active 态

**viewport meta**(`app/layout.tsx`)

```
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
```

**实现要点**

- 单一 hook `lib/use-breakpoint.ts`:薄包装 `antd.Grid.useBreakpoint()`,SSR 安全(首次渲染保守返回桌面,水合后由客户端填入)
- 不引入 Tailwind / 额外 UI 库;`globals.css` 新增 `.pt-safe` / `.pb-safe` 等 4 个安全区工具类
- 桌面端零回归:`StatGrid` 既有响应式断点逻辑不破坏;`ProTable.sticky={isMobile}` 桌面关闭,移动开启
- 唯一行为差异:手机端列表仍是水平滚动,而非卡片流(ProTable 3.1.12-0 beta 的 card 视图 API 暂不稳定,按 plan 接受此 fallback)

## 认证

NextAuth v4 + JWT 策略(不挂 PrismaAdapter,简化 P0 阶段)。

**「7 天内自动登录」**(`lib/auth.ts`)

- 登录页勾选复选框 → JWT 寿命 = 7 天
- 不勾选 → JWT 寿命 = 8 小时
- 实现:自定义 `authOptions.jwt.encode`,根据 `token.remember` 拦截 `maxAge` 参数(`true/缺省 → session.maxAge`,`false → 8 * 3600`)
- e2e:`tests/e2e/auto-login.spec.ts` 用 `jose.jwtDecrypt` + 32 字节 HKDF(与 NextAuth v4 一致)解密 JWE,断言 `exp - iat`

**Cookie 安全**

- 生产 `useSecureCookies` 仅在 `FORCE_HTTPS=true` 时开启;HTTP 反代下保持非 secure 避免登录 cookie 丢失
- 密码用 bcrypt cost=10 哈希;`lastLoginAt` 每次成功登录更新

**会话失效**

- 角色 / 状态 30s TTL 缓存,admin 改角色 / 禁用户最迟 30s 生效
- 30s 内复用避免每个请求打 DB

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

#### Contract 自动转换（system actor）

三个 hook 静默可重入（状态不匹配 → no-op），写入者统一为 `system` 占位用户（`User.isSystem=true`，不可登录）：

- `tryAutoExecuteContract(tx, contractId, trigger)` — 项目 `start` 时 `EFFECTIVE → EXECUTING`，在 `projectAction` 同事务内调用保证原子
- `tryAutoCompleteContract(tx, contractId)` — 合同下所有项目 ∈ {CLOSED, CANCELLED} 且至少 1 个项目时 `EFFECTIVE/EXECUTING/SUSPENDED → COMPLETED`
- `tryAutoExpireContract(contractId, now)` + `runContractExpiryJob(now)` — 每日 01:00 扫 `endDate < now` 的 `EFFECTIVE/EXECUTING` 合同逐笔 Serializable + P2034 重试置 `EXPIRED`

自动转换写 `OperationLog` (`action=CONTRACT_AUTO_*`, `actorId='system'`) + `ContractReviewLog` (`action=AUTO_*`, `reviewerId='system'`) + `Message` (`type=CONTRACT_AUTO_*`)，合同详情页时间线可见。

安全约束：`isSystem=false` 过滤在 `lib/auth.ts` 登录 / 加载用户、`server/events/bus.ts:listAdminUserIds`、`server/services/{asset-expiry-job,workflow}.ts` 通知接收人、`server/jobs/runner.ts` admin 列表 8 处统一加齐，占位用户无合法密码无法登录。详见 `lib/system.ts`。

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
| CONTRACT_AUTO_EXECUTED | 项目 start 触发 EFFECTIVE→EXECUTING | owner + 全部 ADMIN | ✅ |
| CONTRACT_AUTO_COMPLETED | 合同下所有项目收尾 | owner + 全部 ADMIN | ✅ |
| CONTRACT_AUTO_EXPIRED | 定时任务（endDate < now） | owner + 全部 ADMIN | ✅ |

### 定时任务入口

```bash
# 管理员手动触发
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/run-all

# 单跑
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiring
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/invoice-overdue
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/project-due
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/customer-inactive
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiry
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
| RLS | `prisma/migrations/20260614_init/migration.sql`、`lib/rls.ts` |
| i18n | `lib/i18n.ts` |
| 备份 | `scripts/prod/backup.sh`、`scripts/prod/audit-cleanup.sh`、`scripts/dev/loadtest.mjs` |
| Vercel | `vercel.json`、`app/api/jobs/run-all/route.ts` |
| 文档 | `docs/RLS.md`、`docs/P3_REVIEW.md` |

### P3 E2E

```bash
node tests/p3-flow.mjs
```

覆盖 23 用例：公告 CRUD + 靶向角色 + 软删；通知通道关闭无副作用；inbox 异步分发；SALES 行级隔离（应用层）。

### 压测

```bash
node scripts/dev/loadtest.mjs           # 默认 50 并发 × 5s
CONCURRENCY=100 DURATION_MS=10000 node scripts/dev/loadtest.mjs
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

- **本地 cron**：`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
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
