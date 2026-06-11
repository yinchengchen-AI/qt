# 部署前代码审查 — qt-biz v0.1.0

**结论：当前 `main` 分支不应直接部署。** README 标注的"上线就绪"状态与实际质量门不一致。3 个 P0 阻断 + 4 个 P1 风险，需在 1-2 小时内修复。

## 质量门实际结果

| 门               | README 声称 | 实际                   |
| ---------------- | ----------- | ---------------------- |
| `pnpm typecheck` | 0 errors    | **24 errors** ❌        |
| `pnpm lint`      | 0/0         | **配置崩溃** ❌         |
| `pnpm build`     | 成功        | **6 个页面解析失败** ❌ |
| `pnpm test`      | 17/17       | 17/17 ✅                |

## 阻断问题（必须先修）

### P0-1 `next build` 失败 — 6 个表单页 JSX 嵌套错位

所有"新建/编辑"合同、发票、回款、项目的页面，`</FormCard>` 写在了 `</ProForm>` 之前。`SubmitBar` 漂在 `FormCard` 外、却仍在 `ProForm` 内，JSX 解析器拒收。Next 直接报"Parsing ecmascript source code failed"。

```
// app/(app)/contracts/[id]/edit/page.tsx:215-228
        </FormCard>      // ← 提前关闭了 FormCard
        <SubmitBar ... />
      </ProForm>           // ← ProForm 才关
    </Page>
```

6 个文件同一个错法：行号分别是 `contracts/[id]/edit:221`、`contracts/new:223`、`invoices/new:305`、`payments/new:221`、`projects/[id]/edit:158`、`projects/new:205`。

来源是 `f01cfe0 refactor: 全面重写 Dashboard 和统计分析页面 + 客户表单级联选择`，那一次重构把 `FormCard`/`SubmitBar` 的位置换错了。

业务影响：用户**无法新建或编辑**合同/发票/回款/项目。整个核心模块的写入路径全挂。

### P0-2 `tsc --noEmit` 24 错误

与 P0-1 同根。属于 SWC 解析错误，编译器在那一行就报 "JSX element 'ProForm' has no corresponding closing tag"。

### P0-3 ESLint 配置崩溃

`pnpm lint` / `npx eslint .` 直接抛 `TypeError: Key "rules": Key "react-hooks/exhaustive-deps": Could not find plugin "react-hooks"`。

提交 `72e0204 fix(eslint): 去掉 react-hooks 插件重复声明` 删掉了 `plugins: { "react-hooks": reactHooks }` 那块，理由是 next 内部已注册。但 flat-config 的 `plugins` 是 config object 级别的，下游的 `rules: { "react-hooks/*": ... }` 看不到从 `...nextCoreWebVitals` 数组里 spread 出来的 plugin。`core-web-vitals.js` 实际上确实有注册（`dist/index.js:117`），但解析路径在 pnpm 嵌套下没把那个 plugin 暴露给后续 config。

修复路径两个方向：

- 在业务 rules 块里再手动 `plugins: { "react-hooks": ... }`（更稳）
- 把要调的 `react-hooks/*` 规则塞进 `nextCoreWebVitals` 已注册的 rules 块里

README 的"历史 137 条全清 / 0 warnings"也由此失效。

## 仍需关注（P1）

- `prisma/seed.ts:1-2`：`@ts-nocheck` + `// eslint-disable-next-line @typescript-eslint/ban-ts-comment`。种子文件是 dev/CI 阶段产物，不影响生产运行，但属于硬性类型安全原则的破窗。建议把全文件 `customer.create` 数据规范化后去掉。
- `server/jobs/runner.ts` 没有分布式锁或事务包裹。Vercel Cron 单实例部署勉强 OK；若以后改多实例（k8s/容器扩容）会重复发提醒。同时每个候选都重复 `prisma.user.findMany({ role: ADMIN })`，应提到 job run 顶部缓存一次。
- `app/api/jobs/run-all/route.ts:11-12`：`if (cronSecret && auth === Bearer ${cronSecret})` 在 `CRON_SECRET` 未配置时会**静默**回落到 session 鉴权。生产环境忘配 secret，Vercel Cron 会 401，但没有告警。生产环境应硬要求 `CRON_SECRET`，缺失时返回 500 并打印告警。
- `lib/auth.ts:62-64`：`useSecureCookies: false` 是因为现在 HTTP 反代。注释里写了"待配置 HTTPS 后改回"，但**没有运行时断言**保护——一旦切到 HTTPS 没改，cookie 仍以非 secure 发出，登录会被部分浏览器拒收。应加 `process.env.NODE_ENV === "production" && !process.env.FORCE_HTTPS` 之类的护栏。

## 上次审查遗留项的关闭情况

| 上次 P0             | 现状                                                        |
| ------------------- | ----------------------------------------------------------- |
| 登录页测试账号      | **已修** — `process.env.NODE_ENV !== "production"` 三处守门 |
| JWT 每次查 DB       | **已修** — `lib/auth.ts` 加 30s TTL 缓存（`userCache`）     |
| OperationLog 写入点 | **未在本轮复核**（上次 P1 阶段报），需 spot-check           |

## 没有新问题的点（确认 OK）

- `useSWR` 数据获取、zod 校验、prisma $transaction 使用统一
- 没有 `as any` / `@ts-ignore` / `@ts-expect-error` 在 `server/` `lib/` `app/`（只有 `seed.ts` 的 `@ts-nocheck`）
- 全项目只有 1 处 `console.error`（`lib/api.ts:43` 兜底）
- 软删除 / RLS / 审计日志基础设施存在
- `app/global-error.tsx`、`app/not-found.tsx` 已就位
- 4 角色 RBAC、SALES 行级隔离、`Sequence` 表原子编号都有
- `prisma/migrations/` 有 9 条正式迁移，schema 与 `prisma generate` 一致
- `.gitignore` 干净（`.env`、`node_modules`、`.next`、docker-data 都不入库）
- `vercel.json` cron 配置 + 鉴权头都在

## 修复建议路径

按修复耗时排序，建议部署前必做：

1. **30 分钟** 修 6 个表单页的 JSX 嵌套：把 `</ProForm>` 提前到 `</FormCard>` 之前（或反过来移动 `SubmitBar` 进 `FormCard` 内）—— 推荐前者，更符合"FormCard 是外壳，ProForm 是表单"的层级
2. **15 分钟** 修 `eslint.config.mjs`：在业务 rules 块头部加 `plugins: { "react-hooks": (await import("eslint-plugin-react-hooks")).default }`，或者干脆只保留 `exhaustive-deps` 和 `rules-of-hooks` 两条规则其余删掉（其它都是 noisy off 配置）
3. **15 分钟** 跑完整 `pnpm typecheck && pnpm lint && pnpm build && pnpm test` 验证

修完这 3 项后，再决定是否处理 P1 的 cron auth、seed ts-nocheck、distributed lock 之类。

需要我直接动手修这 3 个 P0 吗？或者你倾向先自己看一下再决定？