# qt-biz 全项目代码审查与修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 qt-biz 全项目进行代码审查，修复发现的类型安全、金额计算、行级隔离和 lint 违规问题，并确保 typecheck / lint / tests / build 全部通过。

**Architecture:** 审查覆盖 `app/`, `server/`, `lib/`, `components/`, `tests/`；按 severity 排序，只修复高/中优先级且回归风险可控的问题；不发起大型重构。

**Tech Stack:** Next.js 16 + React 19 + TypeScript 6 strict + Prisma 7 + Ant Design 6 + Vitest + Playwright

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess` 已启用；避免新增 `@ts-ignore` 或 `any`。
- 金额计算必须使用 `Prisma.Decimal`，禁止用 `Number()` / `parseFloat` / `parseInt` 做业务累计（`lib/money.ts`）。
- `SALES` / `EXPERT` 行级隔离通过 `ownerEq` / `ownerViaContract` 注入；查询关联实体时必须沿用同一隔离条件。
- 提交的 migration 不可变；本次修改不涉及 schema 变更。
- 所有修复必须通过 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。

---

## 审查结论摘要

- **代码规模:** 300 个源码文件，87 个测试文件，564 个测试用例。
- **基线状态:** `typecheck` ✅、`lint` ⚠️（1 warning）、`npm test` ✅（564 pass）、`npm run build` ✅。
- **主要风险类别:**
  1. 统计/催收服务里大量 `Number(decimalAmount)` 金额转换，存在浮点漂移风险。
  2. 少量行级隔离缺口（`payment.ts` 创建回款时校验 invoice 未加 `ownerViaContract`）。
  3. 多处不必要的 `as` / `as unknown` 类型断言；`.remember/tmp/last-ndc.ts` 产生 lint warning。
  4. 未发现 SQL 注入、XSS、CSRF、硬编码密钥、权限绕过等高危安全问题。

---

### Task 1: 修复金额计算安全（statistics / dunning / contract）

**Files:**
- Modify: `server/services/statistics.ts`（多处 `Number(...)` 与 `round2`）
- Modify: `server/services/dunning.ts`（`Number(...)` 与 `round2`）
- Modify: `server/services/contract/crud.ts:88-106`（`Number(...)` 计费状态）
- Modify: `server/services/contract/status.ts:126-127`（`Number(...)` 税务计算）
- Test: `tests/api/statistics-aggregation.test.ts` 等已有统计用例

**Interfaces:**
- Consumes: `Prisma.Decimal`, `lib/money.ts#isOverAmount`, `MONEY_TOLERANCE`
- Produces: 统计输出保持原有 number/JSON 形态，仅内部计算走 Decimal

- [ ] **Step 1: 统一 round2 签名支持 Decimal**

把 `statistics.ts` 与 `dunning.ts` 本地定义的 `round2(v: number): number` 改为接受 `number | Prisma.Decimal`，内部用 `new Prisma.Decimal(v).toDecimalPlaces(2).toNumber()` 返回 number，保证对外接口不变。

```typescript
function round2(v: number | Prisma.Decimal): number {
  return new Prisma.Decimal(v).toDecimalPlaces(2).toNumber();
}
```

- [ ] **Step 2: 替换 statistics.ts 中 Number() 转换**

对 `sum._sum.totalAmount` / `sum._sum.amount` / `inv.amount` 等聚合结果，保留 `Number()` 仅在最后输出 JSON 时调用；中间加减比较改为 `new Prisma.Decimal(...).plus(...).greaterThan(...)`。优先修复涉及累计比较的代码路径（如 aging、by-region、top-customers）。

- [ ] **Step 3: 替换 dunning.ts 中 Number() 转换**

`remaining = round2(Number(note.invoice.amount) - ...)` 改为 Decimal 减法后再 `round2`。

- [ ] **Step 4: 修复 contract/crud.ts 计费状态计算**

`getBillingStatus(invoicedAmount, Number(c.totalAmount))` 改为 `getBillingStatus(invoicedAmount, c.totalAmount)`，并确认 `getBillingStatus` 内部已支持 Decimal（如不支持则同步修改）。

- [ ] **Step 5: 修复 contract/status.ts 自动关闭税额计算**

`const total = Number(c.totalAmount); const tax = Number(c.taxRate);` 改为 `calcTaxBreakdown(c.totalAmount, c.taxRate)` 或等效 Decimal 计算。

- [ ] **Step 6: 运行相关测试**

Run: `npx vitest run tests/api/statistics-aggregation.test.ts tests/api/aging.test.ts tests/api/dunning.test.ts tests/api/payment-amount.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/services/statistics.ts server/services/dunning.ts server/services/contract/crud.ts server/services/contract/status.ts
git commit -m "fix(money): 统计/催收/合同状态机金额计算走 Decimal，避免浮点漂移"
```

---

### Task 2: 补齐行级隔离缺口

**Files:**
- Modify: `server/services/payment.ts:115`
- Test: `tests/api/payment-create-guard.test.ts`

**Interfaces:**
- Consumes: `ownerViaContract`, `Prisma.PaymentWhereInput`
- Produces: `createPayment` 中 invoice 存在性查询同样受 SALES 隔离约束

- [ ] **Step 1: 修改 invoice 查询 where 条件**

```typescript
inv = await tx.invoice.findFirst({
  where: { id: input.invoiceId, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) },
});
```

- [ ] **Step 2: 补充/更新测试断言**

在 `tests/api/payment-create-guard.test.ts` 增加：SALES-A 无法在 SALES-B 的合同上通过 invoiceId 越权创建回款（应 404）。

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/api/payment-create-guard.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/services/payment.ts tests/api/payment-create-guard.test.ts
git commit -m "fix(security): 回款创建时 invoice 存在性查询补上行级隔离"
```

---

### Task 3: 清理 lint warning 与不必要的类型断言

**Files:**
- Create: `.eslintignore`
- Modify: `server/services/contract/status.ts:218,298`
- Modify: `server/services/invoice/crud.ts:147-148`
- Test: `npm run lint` 0 warning

**Interfaces:**
- Consumes: ESLint flat config, existing type inference
- Produces: 无新增 warning，不改动运行时行为

- [ ] **Step 1: 创建 .eslintignore 忽略非项目临时文件**

```gitignore
# 临时/缓存目录
.next/
node_modules/
docker-data/
backups/

# 自动化工具生成的临时 TS
.remember/tmp/
```

- [ ] **Step 2: 移除 contract/status.ts 中冗余的 `as unknown as Date`**

Prisma 返回的 `endDate` 已是 `Date`，直接 `new Date(c.endDate)`；若类型推断为 `Date | null`，先判空再 `new Date(c.endDate)`。

- [ ] **Step 3: 简化 invoice/crud.ts 中 amount/taxRate 读取**

`safeInput` 是从已解析的 `InvoiceUpdateInput` 复制而来，`safeInput.amount` 类型已是 `number | undefined`，无需 `as number | undefined`。

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`
Expected: 0 problems

- [ ] **Step 5: Commit**

```bash
git add .eslintignore server/services/contract/status.ts server/services/invoice/crud.ts
git commit -m "style: 清理 lint warning 与冗余类型断言"
```

---

### Task 4: 最终验证

**Files:**
- 所有已修改文件

- [ ] **Step 1: 运行完整 typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 2: 运行完整 lint**

Run: `npm run lint`
Expected: 0 problems

- [ ] **Step 3: 运行完整测试**

Run: `npm test`
Expected: Tests 564 passed

- [ ] **Step 4: 运行生产构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: Commit 验证通过后的任何残余变更（如有）**

---

## Self-Review

1. **Spec coverage:** 覆盖了金额安全、行级隔离、lint/类型清理三大审查主题；未涉及 schema 变更。
2. **Placeholder scan:** 无 TBD/TODO；所有步骤含具体文件路径、代码片段、命令。
3. **Type consistency:** `round2` 统一为 `number | Prisma.Decimal`；统计输出保持 number 以兼容前端/JSON。
