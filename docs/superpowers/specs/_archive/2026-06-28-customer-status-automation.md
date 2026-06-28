> ⚠️ **本 spec 已被 v0.5.0 整体下线取代, 移入 _archive/ 作历史档案。** 实现状态 / 替代文档见
> [docs/superpowers/specs/2026-06-29-customer-status-deprecation.md](../2026-06-29-customer-status-deprecation.md)
> 与 [docs/superpowers/plans/2026-06-29-customer-status-deprecation.md](../../plans/2026-06-29-customer-status-deprecation.md)。

# 客户状态机自动化 (Customer Status Machine Automation)

| 项 | 值 |
|---|---|
| 日期 | 2026-06-28 |
| 状态 | 设计中(2026-06-29 被 deprecation 取代) |
| 范围 | `lib/customer-status-*` / `server/services/customer/*` / `server/services/contract/*` / `server/jobs/customer-status-suggest*` / `app/api/customers/[id]/revert` / 客户详情页 |
| 目标版本 | qt-biz v0.4.x(与当前 main 一致) |
| 落地策略 | **II · 一次提交**(后台 + 前端一次性 PR,带 spec + plan) |

## 1. 背景与目标

### 1.1 现状

四个状态机里客户是自动化程度最低的:

| 状态机 | 自动化程度 |
|---|---|
| Contract | DRAFT→ACTIVE 自动(字段+附件)、ACTIVE→CLOSED 自动(开票足额 / endDate 到期) |
| Invoice | issue 触发自动建 PLANNED Payment |
| Payment | confirm / reconcile / refund 显式 API |
| **Customer** | **只有「每天扫一次发建议消息」,人点消息进详情页再点 Popover 改状态** |

`lib/customer-status-transitions.ts` 的迁移表、`server/services/customer/status.ts` 的 `changeCustomerStatus` (FOR UPDATE 行锁 + Serializable 事务 + 业务校验 R-02/R-13 + 审计 + 事件)、`app/(app)/customers/[id]/page.tsx` 的 `ChangeStatusPopover`、`server/jobs/customer-status-suggest.ts` 的两条规则都已经成熟。**缺的是「状态机触发条件的自动化」** —— 把「人决定改不改」去掉,让系统在条件满足时直接走 `changeCustomerStatus` 写库。

### 1.2 目标

- **业务事件触发**: 合同 `→ ACTIVE` 时,若客户是 `LEAD / NEGOTIATING` 自动写 `SIGNED`(R-02 已保证前置条件)
- **业务事件触发**: 客户名下所有合同都 `→ CLOSED` 且无 `PLANNED / CONFIRMED` 回款时,自动写 `FROZEN`(R-13 一致)
- **时间窗触发**: 90 天无活动 + 无 `ACTIVE` 合同 → 自动写 `LOST`(沿用现有 suggest job 规则 1)
- **时间窗触发**: 60 天无活动 + 所有合同 CLOSED ≥ 30 天 + 无未对账回款 → 自动写 `FROZEN`(沿用现有规则 2)
- **异议窗口期**: 自动写后 7 天内 admin / 业务负责人可手动撤销,回到原状态
- **完整审计**: `audit.action = "CUSTOMER_STATUS_CHANGE"`,`actorId = "system"`,`before / after.status` 一致;每次自动写都通过 `events/bus` 发站内信(type = `CUSTOMER_STATUS_AUTO_APPLIED`),业务负责人在收件箱看到「系统于 X 时把客户 Y 改为 Z」
- **保留人工路径不变**: `changeCustomerStatus` 仍接受 user 上下文,Popover 不动,人工改状态仍走原路径

### 1.3 非目标

- 不实现「客户重命名 / 合并 / 拆分」(客户管理其他 P 任务)
- 不动合同 / 项目 / 开票 / 回款 状态机
- 不实现 admin 规则的 UI 配置页(用 env 静态配,后续 P 阶段再加 UI)
- 不改状态机迁移表本身(LEAD↔NEGOTIATING↔SIGNED↔LOST / FROZEN 表保持,只是「由谁触发」变了)

## 2. 设计

### 2.1 规则配置中心

新文件 `lib/customer-auto-rules.ts`,集中所有「自动写」规则的元数据(规则 ID、目标状态、触发器类型、天数阈值、默认开关、描述)。env 覆盖。

```ts
export type CustomerAutoRule = {
  id: "CONTRACT_ACTIVATED" | "ALL_CONTRACTS_CLOSED" | "INACTIVE_LOST" | "INACTIVE_FROZEN";
  targetStatus: CustomerStatus;
  trigger: "event" | "time";
  envKey: string;
  defaultEnabled: boolean;
  days?: number;
  description: string;
};
```

四个规则:

| ID | 目标 | 触发器 | 天数 | 默认 |
|---|---|---|---|---|
| `CONTRACT_ACTIVATED` | `SIGNED` | event | – | on |
| `ALL_CONTRACTS_CLOSED` | `FROZEN` | event | – | on |
| `INACTIVE_LOST` | `LOST` | time | 90 | on |
| `INACTIVE_FROZEN` | `FROZEN` | time | 60 | on |

env 在 `lib/env.ts` 加:
- `CUSTOMER_AUTO_RULES_DISABLED` = 逗号分隔的 rule id(空 = 全开)
- `CUSTOMER_AUTO_DISPUTE_DAYS` = 7(默认,异议窗口期)

### 2.2 Schema 增量

`prisma/schema.prisma` 的 `Customer` 模型加两列(可选,带默认值,不破坏现有数据):

```prisma
lastAutoAppliedAt DateTime? @db.Timestamptz(6)
lastAutoRule      String?   // CONTRACT_ACTIVATED | ALL_CONTRACTS_CLOSED | INACTIVE_LOST | INACTIVE_FROZEN
```

`@@index([lastAutoAppliedAt])` 不加(只做详情页展示,无扫描场景)。

新迁移文件由 `prisma migrate dev` 自动生成;字段全 nullable,旧数据不需 backfill。

### 2.3 服务层

#### 2.3.1 新增 `autoChangeCustomerStatus`

在 `server/services/customer/status.ts` 加新函数,内部委托现有 `changeCustomerStatus` 但用 `actorId: "system"` 走同一套 `runTransitionInTx`(行锁 + from 校验 + R-02/R-13 + audit + event)。

伪代码:

```ts
export async function autoChangeCustomerStatus(input: {
  customerId: string;
  rule: CustomerAutoRule["id"];
  target: CustomerStatus;
  reason: string;             // auto:<rule>:<human reason>
}) {
  if (!isCustomerStatus(input.target)) throw new ApiError(...);
  return prisma.$transaction(async (tx) => {
    // 行锁 (不绑定 user 角色, 系统调用走 admin 视角)
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    const existing = await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id, status, ownerUserId } });
    if (!existing) return { result: "SKIPPED" as const };
    // from 检查
    if (!ALLOWED_TRANSITIONS_BY_TARGET[input.target].includes(existing.status)) {
      return { result: "SKIPPED" as const };   // 静默跳过(系统调用不允许打断人)
    }
    // 业务校验 R-02 / R-13 复跑(确保前置条件)
    if (input.target === "SIGNED") { ... ACTIVE 合同检查 ... }
    if (input.target === "FROZEN") { ... 活跃合同 + 活跃支付检查 ... }
    // update + 写 lastAutoAppliedAt / lastAutoRule
    const updated = await tx.customer.update({ where: { id }, data: { status: input.target, lastAutoAppliedAt: new Date(), lastAutoRule: input.rule, updatedById: "system" } });
    // audit
    await audit(tx, { actorId: "system", action: "CUSTOMER_STATUS_AUTO_CHANGE", entity: "Customer", entityId: id, before: { status: existing.status }, after: { status: input.target, rule: input.rule, reason: input.reason } });
    // 事件: 给业务负责人发通知(type 暂复用 CUSTOMER_STATUS_SUGGEST, payload 加 rule 字段)
    await emit(tx, { type: "CUSTOMER_STATUS_AUTO_APPLIED", payload: { customerId: id, customerName, from: existing.status, to: input.target, rule: input.rule, reason: input.reason }, receivers: [existing.ownerUserId] });
    return { result: "DONE" as const, updated };
  }, { isolationLevel: Serializable, timeout: 10_000 });
}
```

关键点:
- **不抛 ApiError**:`silentSkip` 模式,因为系统调用不希望打断业务事件(合同刚 ACTIVE 但客户已经手动改成 SIGNED,就静默跳过)
- **`actorId: "system"`**:审计可区分
- **`lastAutoAppliedAt`**:UI 展示「系统 X 天前自动改」和「撤销」按钮可点
- 仍走 `runTransitionInTx` 抽象,审计 / 事件 / 行锁全复用

#### 2.3.2 事件 hook

新文件 `server/services/customer/automation.ts` 暴露两个事件钩子:

```ts
// 合同 → ACTIVE 后调
export async function onContractActivated(contractId: string, tx?: PrismaNS.TransactionClient): Promise<{ applied: boolean; rule?: string }>;
// 合同 → CLOSED 后调
export async function onContractClosed(contractId: string, tx?: PrismaNS.TransactionClient): Promise<{ applied: boolean; rule?: string }>;
```

调用方:
- `server/services/contract/crud.ts` 的 `closeContract` 完成后调 `onContractClosed`
- `server/services/contract/automation.ts` 的 `tryAutoPublish` 把合同推到 ACTIVE 后调 `onContractActivated`

**关键**: `onContractActivated` 在合同 ACTIVE 写入成功后,新开事务调(不能嵌套 Prisma 事务)。`onContractClosed` 同理。

事务边界:合同状态机事务里只动合同 + 合同审计;`onContractActivated` 内部自己开新事务处理客户。这是为了避免「合同事务回滚但客户已经改了」的不一致 —— 但反过来也不会发生,因为客户事务在后,合同事务先提交。

**简化**: 在合同事务 commit 之后,`runTransition` / `runTransitionInTx` 调用方在事务外调一次 `onContractActivated(tx-customerId)` 即可。

#### 2.3.3 suggest job 升级

`server/jobs/customer-status-suggest.ts` 保留「建议发消息」行为,加开关 `CUSTOMER_AUTO_*_ENABLED` 控制:
- 规则关闭时:行为不变(发 `CUSTOMER_STATUS_SUGGEST` 站内信)
- 规则开启时:先尝试 `autoChangeCustomerStatus`,成功不发消息(emit 内部已经发了 `CUSTOMER_STATUS_AUTO_APPLIED`);失败(前置不满足 / 状态已变)才发原建议消息

job 返回 `result = { job, created, scanned, applied, suggestionsKept, durationMs }`,`applied` 计数自动写成功条数,`suggestionsKept` 计数仍发建议的条数。

### 2.4 异议窗口

新 API: `POST /api/customers/[id]/revert`

请求体: `{ reason: string }`(必填,5-200 字,作为新审计的 after.reason)

权限: `CUSTOMER:UPDATE` 即可(SALES 看自己 / ADMIN 全权)。**只能撤销自动写的状态**(检查 `lastAutoAppliedAt != null && now - lastAutoAppliedAt ≤ CUSTOMER_AUTO_DISPUTE_DAYS`);超期返回 `CUSTOMER_AUTO_DISPUTE_EXPIRED` 403。

行为: 走一个新的内部函数 `revertCustomerStatus`:
1. 校验 `lastAutoAppliedAt` 在窗口内
2. 校验当前 `status` 等于 `lastAutoRule` 算出的目标(比如 `lastAutoRule=CONTRACT_ACTIVATED` 对应 `SIGNED`),防止竞态(人已经又改了)
3. **回退目标 = `rule.revertTarget`**(per-rule 配置, 集中在 `lib/customer-auto-rules.ts:CUSTOMER_AUTO_RULES`):
   - `ALL_CONTRACTS_CLOSED` (→ FROZEN) → 回 `NEGOTIATING`
   - `INACTIVE_LOST` (→ LOST) → 回 `NEGOTIATING`
   - `INACTIVE_FROZEN` (→ FROZEN) → 回 `NEGOTIATING`
   - `CONTRACT_ACTIVATED` (→ SIGNED) → 回 `FROZEN`(因为 `ALLOWED_TRANSITIONS_BY_TARGET["NEGOTIATING"] = [LEAD, LOST, FROZEN]`,**不含 SIGNED**, 不能 SIGNED → NEGOTIATING;但 `ALLOWED_TRANSITIONS_BY_TARGET["FROZEN"] = [NEGOTIATING, SIGNED]`, SIGNED → FROZEN 合法)
4. 校验回退目标对当前 from 合法(走 `runTransitionInTx` 的 from 字段)
5. update + 清 `lastAutoAppliedAt` + 写 audit(`action = "CUSTOMER_STATUS_REVERT"`, `actorId = user.id`, `after = { status: target, reason: <用户理由>, revertedFrom: <自动写的原状态> }`)
6. 发站内信 `CUSTOMER_STATUS_AUTO_REVERTED` 给 owner

**关键设计**: 撤销不是「直接写原值」,也不是「统一回 NEGOTIATING」,而是「走合法的状态机迁移,目标按规则配置」。`CONTRACT_ACTIVATED` 这条规则的 from 集合是 SIGNED(目标被系统改成 SIGNED),状态机迁移表里 SIGNED 只能去 LOST/FROZEN,所以选 FROZEN 作为可撤销回退;owner 后续如需重新推进,可手动走 FROZEN → NEGOTIATING。如果撤销时当前状态已经被人工改成 LOST(与 `lastAutoRule` 对应的 target 不一致),撤销按钮不出现(横幅不渲染),避免无谓的 422。

### 2.5 UI

`app/(app)/customers/[id]/page.tsx`:

1. `ChangeStatusPopover` 之上加一个 `<AutoStatusBanner>`:
   - 仅当 `lastAutoAppliedAt != null && (now - lastAutoAppliedAt) ≤ DISPUTE_DAYS` 时显示
   - 内容: 「系统于 {相对时间} 根据「{rule label}」自动将状态变更为 {statusLabel}」+ 「撤销」按钮
   - 「撤销」按钮: 弹 Modal 收集 reason(必填),POST `/api/customers/[id]/revert`
2. `StatusTag` 不动(只是颜色 + label,UI 一致)
3. 撤销成功后 `mutate()` 刷新

`components/customers/auto-status-banner.tsx` 新建,接 `customerId` / `lastAutoAppliedAt` / `lastAutoRule` / `currentStatus` / `onReverted` props。

### 2.6 配置 / 错误码

`lib/env.ts`:
```ts
CUSTOMER_AUTO_RULES_DISABLED: z.string().default(""),          // 逗号分隔
CUSTOMER_AUTO_DISPUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
CUSTOMER_AUTO_INACTIVE_LOST_DAYS: z.coerce.number().int().min(1).max(365).default(90),
CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS: z.coerce.number().int().min(1).max(365).default(60),
```

`types/errors.ts`:
```ts
CUSTOMER_AUTO_DISPUTE_EXPIRED: "CUSTOMER_AUTO_DISPUTE_EXPIRED",
CUSTOMER_AUTO_REVERT_TARGET_INVALID: "CUSTOMER_AUTO_REVERT_TARGET_INVALID",
```
对应中文 message 同样在 i18n 字典里加。

### 2.7 审计 / 事件

- `OperationLog.action` 三种:
  - `CUSTOMER_STATUS_CHANGE`(人改,已存在)
  - `CUSTOMER_STATUS_AUTO_CHANGE`(系统自动写,新增)
  - `CUSTOMER_STATUS_REVERT`(人撤销,新增)
- 事件 `Message.type`:
  - 现有 `CUSTOMER_STATUS_SUGGEST`(人改的建议,保持)
  - 新增 `CUSTOMER_STATUS_AUTO_APPLIED`(系统自动写,owner 收)
  - 新增 `CUSTOMER_STATUS_AUTO_REVERTED`(系统写被撤销,owner 收)
- `Message.link`: `{ id, kind: "customer" }` 仍指向客户详情页

## 3. 数据流

### 3.1 业务事件(合同 ACTIVE → 客户 SIGNED)

```
sales 创建/编辑合同 → tryAutoPublish (现有)
  → 合同事务 commit (status = ACTIVE)
  → onContractActivated(contractId)  (新增, 事务外)
    → 查 contract.customerId
    → 查 customer (in new tx)
    → from 校验: customer.status ∈ {LEAD, NEGOTIATING}
    → R-02 校验: ACTIVE 合同数 ≥ 1 (因为新合同就是 ACTIVE, 这里一定 ≥ 1)
    → autoChangeCustomerStatus({ target: SIGNED, rule: CONTRACT_ACTIVATED })
    → tx.customer.update({ status: SIGNED, lastAutoAppliedAt, lastAutoRule })
    → audit(actorId=system, action=CUSTOMER_STATUS_AUTO_CHANGE)
    → emit(CUSTOMER_STATUS_AUTO_APPLIED, receivers=[owner])
```

### 3.2 时间窗(90 天无活动 → LOST)

```
runAllJobs 调 tickCustomerStatusSuggestions (升级)
  → loadCandidates 同现有
  → 对每个候选:
    → if rule 开启: 调 autoChangeCustomerStatus
      → 成功: applied++
      → 失败 (前置不满足 / 状态已变): fallthrough 到原 emit CUSTOMER_STATUS_SUGGEST
    → if rule 关闭: 直接发 CUSTOMER_STATUS_SUGGEST (现有行为)
```

## 4. 测试

### 4.1 单元测试 (Vitest, 现有 mock 风格)

`tests/unit/server/customer-status-automation.test.ts` (新建):
- `autoChangeCustomerStatus` 成功路径: NEGOTIATING + ACTIVE 合同 → SIGNED, audit action = `CUSTOMER_STATUS_AUTO_CHANGE`, actorId = `system`, lastAutoAppliedAt / lastAutoRule 写入
- 同状态跳过(已 SIGNED 再触发): 返回 SKIPPED, 不抛错
- from 不合法(LEAD → FROZEN): SKIPPED 静默
- R-02 失败(无 ACTIVE 合同, 模拟合同已 CLOSED): SKIPPED
- 业务事件模拟: `onContractActivated` 串到客户状态, owner 收到 `CUSTOMER_STATUS_AUTO_APPLIED` 消息
- `revertCustomerStatus` 成功: SIGNED → NEGOTIATING, lastAutoAppliedAt 清空, audit action = `CUSTOMER_STATUS_REVERT`, actorId = user.id
- revert 超期: 抛 `CUSTOMER_AUTO_DISPUTE_EXPIRED` 403
- revert 时客户状态已被人改: 抛 `CUSTOMER_AUTO_REVERT_TARGET_INVALID` 422

`tests/unit/server/customer-status-suggest.test.ts` (升级):
- 现有 5 个用例全保留(规则关闭时走建议路径)
- 新增: 规则开启时 LOST 命中 → emit 收到 `CUSTOMER_STATUS_AUTO_APPLIED`, 不发 `CUSTOMER_STATUS_SUGGEST`
- 新增: 规则开启时 R-13 不满足(有 PLANNED 支付) → fallthrough 到发 `CUSTOMER_STATUS_SUGGEST`

`tests/unit/lib/customer-auto-rules.test.ts` (新建):
- `isRuleEnabled` 在默认 / 自定义 env 下行为
- `CUSTOMER_AUTO_RULES_DISABLED` 解析

### 4.2 E2E (Playwright)

`tests/e2e/15-customer-status-automation.spec.ts` (新建):
- 场景 1: SALES 创建合同 + 编辑到满足 publishable, 提交后客户详情页 `lastAutoAppliedAt` 出现 + 系统消息收件箱出现
- 场景 2: 7 天窗口内 admin 点「撤销」, 客户状态回退 + 审计 OperationLog 出现 `CUSTOMER_STATUS_REVERT`
- 场景 3: env `CUSTOMER_AUTO_RULES_DISABLED=INACTIVE_LOST` 后, 90 天无活动的客户不发系统消息, 仍发建议消息

### 4.3 手工 / 集成

`docs/USER_MANUAL.md` 加一节「客户状态机自动化」,写明:
- 系统会在什么条件下自动改状态
- 怎么撤销
- 怎么临时关掉某条规则(env)

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| 自动写错状态(比如合同被误激活) | 7 天窗口内可撤销;`OperationLog` 完整审计;事件总线发通知,owner 看得见 |
| 时间窗规则误判(节假日 / 人员外出) | 异议窗口期内人工可撤;`CUSTOMER_AUTO_RULES_DISABLED` env 一键关 |
| 与人工改的竞态 | 行锁 `FOR UPDATE` + 状态机迁移表 + `silentSkip` 不打断;撤销时再校验 `lastAutoRule` 对应的目标 |
| Prisma 迁移破坏现有数据 | 两列都 nullable, 无 backfill, 旧数据全 null 视为「非自动」 |
| E2E 跑得慢 | 时间窗规则在 E2E 里不依赖真实时间流逝, 用 mock 或短缩 env(测试环境 `CUSTOMER_AUTO_DISPUTE_DAYS=1`) |

## 6. 落地步骤(高层)

1. **Schema + env**: 改 `prisma/schema.prisma` 加两列, `lib/env.ts` 加 4 个 env, `prisma migrate dev` 生成迁移
2. **配置中心**: 新建 `lib/customer-auto-rules.ts`
3. **服务层**: 在 `server/services/customer/status.ts` 加 `autoChangeCustomerStatus` + `revertCustomerStatus`; 新建 `server/services/customer/automation.ts` 暴露 `onContractActivated` / `onContractClosed`
4. **事件 hook**: `server/services/contract/automation.ts` / `crud.ts` 在合同 ACTIVE / CLOSED 后调
5. **job 升级**: `server/jobs/customer-status-suggest.ts` 改造
6. **API**: `app/api/customers/[id]/revert/route.ts` 新建
7. **UI**: `app/(app)/customers/[id]/page.tsx` 加 `AutoStatusBanner`; 新建 `components/customers/auto-status-banner.tsx`
8. **错误码**: `types/errors.ts` + i18n 文案
9. **测试**: 三组单测 + 一个 E2E
10. **文档**: USER_MANUAL 一节 + DESIGN-v3 §5.x 一节
11. **跑通**: `npm run typecheck` + `npm run lint` + `npm test` + `npm run test:e2e -- 15-*` + `git commit -m "feat(customer): 状态机自动化 (业务事件 + 时间窗 + 7 天异议窗口)"`

## 7. Assumptions(默认决定)

- **自动写是默认行为**: admin 不需要主动开;env 关掉某条规则是 opt-out
- **7 天窗口是默认**: env `CUSTOMER_AUTO_DISPUTE_DAYS` 可调
- **撤销目标走状态机迁移表**: 不会「直接写」原值,保留审计完整性
- **actorId = "system"**: 字面字符串,审计日志里可一眼区分;**不**给 system 建真实 user 记录(避免 admin 列表干扰)
- **消息 type 新增两个**: `CUSTOMER_STATUS_AUTO_APPLIED` / `CUSTOMER_STATUS_AUTO_REVERTED`,沿用现有 Message 表,不加新列
- **不新增权限点**: 撤销走 `CUSTOMER:UPDATE`,与人工改状态一致(SALES 可撤自己客户的自动写)
- **不写 E2E 用真实时间**: 测试环境用短缩 env,生产保持 7 天
- **不实现 admin 规则 UI 配置**: env 静态配,Dictionary 化下个 P 阶段

---

> **下一步**: 出实施计划(`docs/superpowers/plans/2026-06-28-customer-status-automation.md`),按计划任务粒度逐条实现。
