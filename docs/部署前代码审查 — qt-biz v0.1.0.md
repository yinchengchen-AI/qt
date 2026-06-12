# 部署前代码审查 — qt-biz v0.1.0

> **状态更新 (2026-06-12, commit 55ed8d2 之后):原 3 P0 阻断已全部修复,2/4 P1 风险已修复,仓库达到可上线条件。**
>
> 历史 P0/P1 列表保留在下文以追溯;每条标 ✅/⚠️ 标注当前状态与修复 commit。
> 修复后实测质量门见 [§ 当前质量门](#当前质量门-2026-06-12) 一节。

## 当前质量门 (2026-06-12)

| 门 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 errors** ✅ |
| `npx eslint .` | **0 errors / 19 warnings**(unused imports + `any` 类型,非阻断) |
| `npx vitest run` | **17/17 passed** ✅ |
| `npx next build` | **成功**,50 路由全部编译 ✅ |
| `npx next start` 烟测 | 62ms 起服,`/login` 200、`/dashboard` 307、`/api/customers` 401 ✅ |

**结论:commit `55ed8d2` 之后的 main 分支可直接部署,前提是生产环境变量按 README 替换(CRON_SECRET / APP_ENC_KEY_HEX / DATABASE_URL / MINIO_* / APP_PUBLIC_URL)。**

---

## 历史审查记录 (2026-06-11)

### 原结论

**结论:原 `main` 分支(commit `4c7ecad` 之前)不应直接部署。** README 标注的"上线就绪"状态与实际质量门不一致。3 个 P0 阻断 + 4 个 P1 风险,需在 1-2 小时内修复。

### 原质量门结果(commit `4f64031` 之前,已修复)

| 门               | README 声称 | 实际                   |
| ---------------- | ----------- | ---------------------- |
| `pnpm typecheck` | 0 errors    | **24 errors** ❌ → **0 errors** ✅ (commit `4c7ecad`)        |
| `pnpm lint`      | 0/0         | **配置崩溃** ❌ → **0 errors / 19 warnings** ✅ (commit `af871fd`)         |
| `pnpm build`     | 成功        | **6 个页面解析失败** ❌ → **成功** ✅ (commit `4c7ecad`) |
| `pnpm test`      | 17/17       | 17/17 ✅ (本轮无变更)        |

### 原 P0 阻断 (当前状态)

- ✅ **P0-1 `next build` 失败 — 6 个表单页 JSX 嵌套错位** — **已修复 (commit `4c7ecad`)**。把 `<SubmitBar>` 放回 `<ProForm>` 内部,与 `<FormCard>` 同级,build 恢复。

- ✅ **P0-2 `tsc --noEmit` 24 错误** — **已修复 (commit `4c7ecad`)**。与 P0-1 同根,JSX 闭合归位后 SWC 解析通过。

- ✅ **P0-3 ESLint 配置崩溃** — **已修复 (commit `af871fd`)**。重命名 `eslint.config.mjs` → `eslint.config.js`,修复 flat-config 在 pnpm 嵌套下 plugin 解析路径。`npx eslint .` 现 0 errors。

### 原 P1 风险 (当前状态)

- ⚠️ **P1-1 `prisma/seed.ts:1-2` `@ts-nocheck`** — **未修(可接受)**。种子文件仅 dev/CI 阶段运行,不影响生产。`scripts/audit-cleanup.sh` 暂未触及;建议 v0.2 规范化种子数据后去掉。
- ⚠️ **P1-2 `server/jobs/runner.ts` 无分布式锁** — **未修(可接受)**。Vercel Cron 单实例 OK,多实例(k8s/容器扩容)会重复触发。`runAllJobs` 已预取 admin 列表消除 N+1;补锁可放 v0.2。
- ✅ **P1-3 `/api/jobs/run-all` 静默回落 session** — **已修复 (commit `803275a`)**。生产环境硬要求 `CRON_SECRET`,缺失时 500 告警;非生产保留 session 回落供本地测试。
- ✅ **P1-4 `useSecureCookies` 缺运行时护栏** — **已修复 (commit `803275a`)**。`useSecureCookies` 由 `FORCE_HTTPS` 决定,生产环境若未配 HTTPS 输出 `[AUTH] 生产环境使用非 Secure Cookie` 警告,提示运维补强。

### 上次审查遗留项的关闭情况

| 上次 P0             | 现状                                                        |
| ------------------- | ----------------------------------------------------------- |
| 登录页测试账号      | **已修** — `process.env.NODE_ENV !== "production"` 三处守门 |
| JWT 每次查 DB       | **已修** — `lib/auth.ts` 加 30s TTL 缓存(`userCache`)     |
| OperationLog 写入点 | **未在本轮复核**(上次 P1 阶段报),需 spot-check           |

### 没有新问题的点(确认 OK)

- `useSWR` 数据获取、zod 校验、prisma `$transaction` 使用统一
- 没有 `as any` / `@ts-ignore` / `@ts-expect-error` 在 `server/` `lib/` `app/`(只有 `seed.ts` 的 `@ts-nocheck`)
- 全项目只有 2 处 `console.error`(`lib/api.ts:43` 兜底 + `app/api/jobs/run-all/route.ts:16` CRON 告警)
- 软删除 / RLS / 审计日志基础设施存在
- `app/global-error.tsx`、`app/not-found.tsx` 已就位
- 4 角色 RBAC、SALES 行级隔离(`lib/ownership.ts` 统一封装)、`Sequence` 表原子编号都有
- `prisma/migrations/` 有 9 条正式迁移,schema 与 `prisma generate` 一致
- `.gitignore` 干净(`.env`、`node_modules`、`.next`、docker-data 都不入库)
- `vercel.json` cron 配置 + 鉴权头都在

### 修复建议路径(已执行)

1. ✅ **30 分钟** 修 6 个表单页的 JSX 嵌套 — commit `4c7ecad`
2. ✅ **15 分钟** 修 `eslint.config.mjs` — commit `af871fd`
3. ✅ **15 分钟** 跑完整 `tsc && eslint && next build && vitest` 验证 — 见 [当前质量门](#当前质量门-2026-06-12)

---

## commit `55ed8d2` 落盘清单 (2026-06-12)

在上述 P0/P1 全部修复基础上,本轮新增 22 文件变更,重点:

| 类型 | 改动 |
|---|---|
| **refactor** | `lib/ownership.ts`(新):把 SALES 行级隔离 + 状态列表解析抽到统一 helper;5 个 service 全切到新 helper |
| **fix** | `/api/dashboard/summary`: SALES 角色对 project/invoice/payment 应走 `ownerViaContract`(经 contract 关系),原代码直接用 `ownerUserId` 漏隔离,本轮修复 |
| **perf** | `getTopCustomers` 从 1 + N×4 N+1 拍平为 4 次常量查询(`groupBy by customerId`) |
| **feat(api)** | `/api/dashboard/summary` 接受 `from/to`;`/api/operation-logs` 接受 `from/to`;`/api/customers` `status`/`scale` 支持逗号分隔多值 |
| **feat(ui)** | Sider 分组手风琴/多开切换(底部按钮 + localStorage 持久化) |
| **chore** | `lib/use-list-request.ts` KNOWN_KEYS 删除 `customerType`/`serviceType`(前端走 valueEnum 渲染,不在服务端过滤) |

涉及文件(22 modified + 1 added = 23):

```
A  lib/ownership.ts
M  app/(app)/admin/operation-logs/page.tsx
M  app/(app)/contracts/page.tsx
M  app/(app)/customers/page.tsx
M  app/(app)/dashboard/page.tsx
M  app/(app)/invoices/page.tsx
M  app/(app)/payments/page.tsx
M  app/(app)/projects/page.tsx
M  app/api/customers/route.ts
M  app/api/customers/export/route.ts
M  app/api/dashboard/summary/route.ts
M  app/api/messages/route.ts
M  app/api/operation-logs/route.ts
M  app/api/statistics/overview/route.ts
M  components/dashboard-shell.tsx
M  lib/use-list-request.ts
M  server/services/contract.ts
M  server/services/customer.ts
M  server/services/invoice.ts
M  server/services/payment.ts
M  server/services/project.ts
M  server/services/statistics.ts
```

## 部署平台侧前置清单(代码内已就绪,运维需确认)

1. **生产环境变量**(由 Vercel/部署平台注入,覆盖仓库 `.env`):
   - `NEXTAUTH_SECRET` / `NEXTAUTH_URL`
   - `APP_PUBLIC_URL`(占位 `https://app.example.com`)
   - `APP_ENC_KEY_HEX`(32 字节 hex,64 字符;`.env` 当前全 0 必须生成真值)
   - `CRON_SECRET` ≥ 16 字符(`run-all` 路由生产硬要求,缺失 500)
   - `DATABASE_URL` / `MINIO_*` 指向生产 S3 兼容存储 + CDN
   - 通知三通道默认全关,按需开启
2. **生产库迁移**:`npx prisma migrate deploy`(仓库已有 9 条正式迁移;**不要用 `db push`**)
3. **备份**:`scripts/backup.sh` 纳入 cron
4. **监控**:目前无 error tracking(Sentry 等),建议接入
