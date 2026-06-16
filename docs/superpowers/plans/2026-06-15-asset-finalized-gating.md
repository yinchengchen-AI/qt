# 资产库 · 入库前置条件（合同/项目已完成）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业绩证明 (PERFORMANCE) 必须关联"已完成"合同，项目案例 (CASE) 必须关联"已验收/已关闭"项目，挡在表单 picker 与服务端断言两道关；不传关联 ID 的"独立业绩/纯文字案例"继续允许；存量数据只读兼容。

**Architecture:** 新增纯函数式断言（不依赖 Prisma），单元可测；服务层在 `createAsset` / `updateAsset` / 导入路径里调断言；表单 picker 通过收紧 `?status=` 列表让用户根本看不到未完成的合同/项目。常量集中在 `lib/assets/finalized-statuses.ts`，避免散落。

**Tech Stack:** Next.js 15 App Router、Prisma 7.8、Zod 3、Vitest、ExcelJS（导入路径）、antd ProForm（前端）。

---

## File Map

| 路径 | 角色 | 改动类型 |
|---|---|---|
| `lib/assets/finalized-statuses.ts` | 新建 · "可入库"状态常量 + 纯函数断言 | 新建 |
| `lib/validators/asset.ts` | 引用上面常量；Zod schema 不变 | 微改 |
| `server/services/asset.ts` | `createAsset` / `updateAsset` 调用新断言；`findUnique`→`findFirst` 顺手修 | 改 |
| `server/services/asset-import.ts` | `bulkImportAssets` 同样校验 | 改 |
| `components/assets/asset-type-fields.tsx` | 收紧 contract picker / project picker 的 `?status=` | 改 |
| `tests/unit/assets/finalized-statuses.test.ts` | 纯函数断言单测 | 新建 |
| `tests/unit/assets/asset-service-gating.test.ts` | 服务层用 vi.mock 验证断言被调用（create + update） | 新建 |
| `tests/unit/assets/asset-import-gating.test.ts` | `bulkImportAssets` 路径的行级断言单测 | 新建 |
| `docs/USER_MANUAL.md` | 新增"13.x 企业资产库"小节，文档化新规则 | 改 |

---

## 业务规则（不可变约束 + 待确认项）

- **PERFORMANCE 合同白名单**：`COMPLETED`（"已完成"）
- **CASE 项目白名单**：`ACCEPTED`（"已验收"）、`CLOSED`（"已关闭"）
- **不传 `contractId` / `projectId`**：跳过断言，保留"独立业绩/纯文字案例"的旧用法
- **存量数据**：旧 PERFORMANCE/CASE 记录若关联到非白名单合同/项目，列表/详情继续展示；若编辑重新保存，必须将 `contractId`/`projectId` 改为白名单内的 ID 或置空

### 业务侧待确认（落代码前可调一行常量即可）

- **EXECUTING**（"执行中"）的合同算不算可入库业绩？默认**不放行**（按"完成"语义）。若业务侧需要"在执行大单"做投标加分，把 `PERFORMANCE_ALLOWED_CONTRACT_STATUSES` 改为 `["COMPLETED", "EXECUTING"]`。
- **DELIVERED**（"已交付"未验收）的项目算不算可入库案例？默认**不放行**。改 `CASE_ALLOWED_PROJECT_STATUSES` 加上即可。

---

## Task 0: 观察存量数据（部署前必做，影响风险评估）

**Files:**
- Create: `scripts/audit-non-finalized-assets.ts`
- Create: `tests/unit/assets/non-finalized-audit.test.ts`（验证脚本逻辑可单测）

- [ ] **Step 1: 写一个查询脚本，统计"绑了非白名单合同/项目的资产"**

```ts
// scripts/audit-non-finalized-assets.ts
// 跑法: pnpm exec tsx scripts/audit-non-finalized-assets.ts
import { prisma } from "@/lib/prisma";
import {
  PERFORMANCE_ALLOWED_CONTRACT_STATUSES,
  CASE_ALLOWED_PROJECT_STATUSES
} from "@/lib/assets/finalized-statuses";

export async function auditNonFinalizedAssets() {
  // 1) PERFORMANCE 资产,取出 contractId,然后 join contract.status
  const perfAssets = await prisma.companyAsset.findMany({
    where: { type: "PERFORMANCE", deletedAt: null, attributes: { path: ["contractId"], not: undefined as never } },
    select: { id: true, code: true, name: true, attributes: true }
  });
  const perfContractIds = Array.from(
    new Set(
      perfAssets
        .map((a) => (a.attributes as Record<string, unknown>)?.contractId)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );
  const perfContracts = perfContractIds.length
    ? await prisma.contract.findMany({
        where: { id: { in: perfContractIds }, deletedAt: null },
        select: { id: true, status: true }
      })
    : [];
  const perfContractStatus = new Map(perfContracts.map((c) => [c.id, c.status]));
  const perfViolations = perfAssets.filter((a) => {
    const cid = (a.attributes as Record<string, unknown>).contractId as string;
    const status = perfContractStatus.get(cid);
    return status && !(PERFORMANCE_ALLOWED_CONTRACT_STATUSES as readonly string[]).includes(status);
  });

  // 2) CASE 同理
  const caseAssets = await prisma.companyAsset.findMany({
    where: { type: "CASE", deletedAt: null },
    select: { id: true, code: true, name: true, attributes: true }
  });
  const caseProjectIds = Array.from(
    new Set(
      caseAssets
        .map((a) => (a.attributes as Record<string, unknown>)?.projectId)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );
  const caseProjects = caseProjectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: caseProjectIds }, deletedAt: null },
        select: { id: true, status: true }
      })
    : [];
  const caseProjectStatus = new Map(caseProjects.map((p) => [p.id, p.status]));
  const caseViolations = caseAssets.filter((a) => {
    const pid = (a.attributes as Record<string, unknown>).projectId as string;
    const status = caseProjectStatus.get(pid);
    return status && !(CASE_ALLOWED_PROJECT_STATUSES as readonly string[]).includes(status);
  });

  return { perfViolations, caseViolations };
}

if (require.main === module) {
  auditNonFinalizedAssets().then((r) => {
    console.log(`PERFORMANCE 关联非 COMPLETED 合同: ${r.perfViolations.length} 条`);
    console.log(`CASE 关联非 ACCEPTED/CLOSED 项目: ${r.caseViolations.length} 条`);
    process.exit(0);
  });
}
```

- [ ] **Step 2: 在测试数据库跑一遍，把数字报给业务侧**

```bash
pnpm exec tsx scripts/audit-non-finalized-assets.ts
```

> 这一步是部署前的**风险评估**，不上线前必须完成。零条表示无存量影响，可直接上线；非零则需评估"是否要给这批资产批量置空 contractId / projectId"，或者把上线策略改成"新规则只对**新增**生效，对存量宽限 N 天"。

- [ ] **Step 3: 提交**

```bash
git add scripts/audit-non-finalized-assets.ts
git commit -m "chore(assets): 上线前存量数据观察脚本"
```

---

## Task 1: 引入状态常量与纯函数断言

**Files:**
- Create: `lib/assets/finalized-statuses.ts`
- Create: `tests/unit/assets/finalized-statuses.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/assets/finalized-statuses.test.ts
import { describe, it, expect } from "vitest";
import {
  PERFORMANCE_ALLOWED_CONTRACT_STATUSES,
  CASE_ALLOWED_PROJECT_STATUSES,
  assertContractStatusForPerformance,
  assertProjectStatusForCase,
  ContractNotFinalizedError,
  ProjectNotFinalizedError,
  ContractMissingError
} from "@/lib/assets/finalized-statuses";

describe("PERFORMANCE 合同状态白名单 (helper)", () => {
  it("白名单只包含 COMPLETED", () => {
    expect(PERFORMANCE_ALLOWED_CONTRACT_STATUSES).toEqual(["COMPLETED"]);
  });
  it("COMPLETED 合同通过断言", () => {
    expect(() =>
      assertContractStatusForPerformance({ status: "COMPLETED" })
    ).not.toThrow();
  });
  it.each([
    "DRAFT", "PENDING_REVIEW", "EFFECTIVE", "EXECUTING", "TERMINATED", "EXPIRED"
  ])("非完成态 %s 抛 ContractNotFinalizedError", (status) => {
    expect(() => assertContractStatusForPerformance({ status: status as never })).toThrow(
      ContractNotFinalizedError
    );
  });
  it("合同对象为 null 抛 ContractMissingError", () => {
    expect(() => assertContractStatusForPerformance(null)).toThrow(
      ContractMissingError
    );
  });
});

describe("CASE 项目状态白名单 (helper)", () => {
  it("白名单只包含 ACCEPTED / CLOSED", () => {
    expect([...CASE_ALLOWED_PROJECT_STATUSES].sort()).toEqual(["ACCEPTED", "CLOSED"]);
  });
  it.each(["ACCEPTED", "CLOSED"])("已完成态 %s 通过断言", (status) => {
    expect(() => assertProjectStatusForCase({ status: status as never })).not.toThrow();
  });
  it.each([
    "PLANNED", "IN_PROGRESS", "SUSPENDED", "DELIVERED", "CANCELLED"
  ])("非完成态 %s 抛 ProjectNotFinalizedError", (status) => {
    expect(() => assertProjectStatusForCase({ status: status as never })).toThrow(
      ProjectNotFinalizedError
    );
  });
  it("项目对象为 null 不抛(项目 ID 可选)", () => {
    expect(() => assertProjectStatusForCase(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/unit/assets/finalized-statuses.test.ts
```

期望：`Cannot find module '@/lib/assets/finalized-statuses'`

- [ ] **Step 3: 实现模块**

```ts
// lib/assets/finalized-statuses.ts
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { ContractStatus, ProjectStatus } from "@/types/enums";

/** PERFORMANCE 业绩证明允许关联的合同状态(白名单)
 *  - 业务语义:业绩是"回头看"的素材,只接受已收尾的合同
 *  - 留 EXECUTING/EFFECTIVE 会让销售拿到半成品合同做宣传,故不放行
 */
export const PERFORMANCE_ALLOWED_CONTRACT_STATUSES = ["COMPLETED"] as const;
export type PerformanceAllowedContractStatus =
  (typeof PERFORMANCE_ALLOWED_CONTRACT_STATUSES)[number];

/** CASE 项目案例允许关联的项目状态(白名单)
 *  - ACCEPTED(已验收) + CLOSED(已关闭) 视为"完成"
 *  - DELIVERED(已交付)留作边界:客户未签收,故不放行
 */
export const CASE_ALLOWED_PROJECT_STATUSES = ["ACCEPTED", "CLOSED"] as const;
export type CaseAllowedProjectStatus =
  (typeof CASE_ALLOWED_PROJECT_STATUSES)[number];

export class ContractMissingError extends ApiError {
  constructor() {
    super(ERROR_CODES.VALIDATION_FAILED, "关联的合同不存在或已删除", 400);
  }
}

export class ContractNotFinalizedError extends ApiError {
  constructor(current: ContractStatus) {
    super(
      ERROR_CODES.VALIDATION_FAILED,
      `业绩证明只能关联已完成的合同(当前合同状态:${current})`,
      400
    );
  }
}

export class ProjectNotFinalizedError extends ApiError {
  constructor(current: ProjectStatus) {
    super(
      ERROR_CODES.VALIDATION_FAILED,
      `项目案例只能关联已验收或已关闭的项目(当前项目状态:${current})`,
      400
    );
  }
}

export function assertContractStatusForPerformance(
  contract: { status: ContractStatus } | null
): void {
  if (!contract) throw new ContractMissingError();
  if (
    !(PERFORMANCE_ALLOWED_CONTRACT_STATUSES as readonly ContractStatus[]).includes(
      contract.status
    )
  ) {
    throw new ContractNotFinalizedError(contract.status);
  }
}

export function assertProjectStatusForCase(
  project: { status: ProjectStatus } | null
): void {
  if (!project) return; // projectId 可选,允许独立案例
  if (
    !(CASE_ALLOWED_PROJECT_STATUSES as readonly ProjectStatus[]).includes(
      project.status
    )
  ) {
    throw new ProjectNotFinalizedError(project.status);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/unit/assets/finalized-statuses.test.ts
```

期望：所有用例 PASS

- [ ] **Step 5: 提交**

```bash
git add lib/assets/finalized-statuses.ts tests/unit/assets/finalized-statuses.test.ts
git commit -m "feat(assets): 新增合同/项目完成态白名单与纯函数断言"
```

---

## Task 2: 服务层接入新断言(PERFORMANCE 合同 + create/update 路径)

**Files:**
- Modify: `server/services/asset.ts:78-110`（`assertPerformanceContractAmount` 内,顺手把 `findUnique` 换成 `findFirst` 修预存在的 TS 漏洞）
- Modify: `server/services/asset.ts:127`（`createAsset` 内部调用名）
- Create: `tests/unit/assets/asset-service-gating.test.ts`

- [ ] **Step 1: 写失败测试（create + update 两组）**

```ts
// tests/unit/assets/asset-service-gating.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// rlsTransaction 关键:tx 必须自带 companyAsset.create/findFirst/update
// 否则服务层会抛 TypeError(tx.companyAsset is undefined),根本走不到断言
const txMock = {
  companyAsset: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  }
};
vi.mock("@/lib/rls", () => ({
  rlsTransaction: async (_p: unknown, _u: unknown, fn: (tx: unknown) => unknown) =>
    fn(txMock)
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    companyAsset: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    }
  }
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/sequence", () => ({
  nextBusinessNo: vi.fn().mockResolvedValue("QT-ASSET-2026-0001")
}));
vi.mock("@/lib/permissions", () => ({
  requirePermission: vi.fn(),
  RESOURCE: { ASSET: "ASSET" },
  ACTION: { CREATE: "CREATE", READ: "READ", UPDATE: "UPDATE", DELETE: "DELETE" }
}));
vi.mock("@/lib/assets/status", () => ({
  computeAssetStatus: () => "VALID"
}));

import { prisma } from "@/lib/prisma";
import { createAsset, updateAsset } from "@/server/services/asset";

const admin = { id: "u1", roleCode: "ADMIN" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  txMock.companyAsset.create.mockResolvedValue({ id: "a1" });
  txMock.companyAsset.update.mockResolvedValue({ id: "a1", status: "VALID" });
  txMock.companyAsset.findFirst.mockResolvedValue({
    id: "a1",
    name: "old",
    attributes: { contractId: "cid-1" },
    type: "PERFORMANCE"
  });
});

describe("createAsset · PERFORMANCE 合同状态门禁", () => {
  it("选了合同但合同 EXECUTING → 抛错且不写库", async () => {
    (prisma.contract.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "EXECUTING",
      totalAmount: 100
    });
    await expect(
      createAsset(admin as never, {
        type: "PERFORMANCE",
        name: "某业绩",
        tags: [],
        attributes: {
          projectName: "p",
          customerName: "c",
          serviceType: "SAFETY_CONSULT",
          contractAmount: 100,
          contractId: "cid-1"
        }
      } as never)
    ).rejects.toThrow(/已完成的合同/);
    expect(txMock.companyAsset.create).not.toHaveBeenCalled();
  });

  it("选了合同且 COMPLETED → 放行", async () => {
    (prisma.contract.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "COMPLETED",
      totalAmount: 100
    });
    await createAsset(admin as never, {
      type: "PERFORMANCE",
      name: "某业绩",
      tags: [],
      attributes: {
        projectName: "p",
        customerName: "c",
        serviceType: "SAFETY_CONSULT",
        contractAmount: 100,
        contractId: "cid-1"
      }
    } as never);
    expect(txMock.companyAsset.create).toHaveBeenCalledTimes(1);
  });

  it("不传 contractId → 跳过断言", async () => {
    await createAsset(admin as never, {
      type: "PERFORMANCE",
      name: "独立业绩",
      tags: [],
      attributes: {
        projectName: "p",
        customerName: "c",
        serviceType: "SAFETY_CONSULT"
      }
    } as never);
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateAsset · PERFORMANCE 合同状态门禁(关键路径)", () => {
  it("不改 contractId 但原合同状态是 EXECUTING → 保存失败", async () => {
    txMock.companyAsset.findFirst.mockResolvedValue({
      id: "a1",
      name: "old",
      attributes: { contractId: "cid-old" },
      type: "PERFORMANCE"
    });
    (prisma.contract.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "EXECUTING",
      totalAmount: 100
    });
    await expect(
      updateAsset(admin as never, "a1", {
        description: "改个描述"
      } as never)
    ).rejects.toThrow(/已完成的合同/);
    expect(txMock.companyAsset.update).not.toHaveBeenCalled();
  });

  it("换成 COMPLETED 合同的 contractId → 放行", async () => {
    (prisma.contract.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "COMPLETED",
      totalAmount: 200
    });
    await updateAsset(admin as never, "a1", {
      attributes: { contractId: "cid-new", contractAmount: 200 }
    } as never);
    expect(txMock.companyAsset.update).toHaveBeenCalledTimes(1);
  });

  it("把 contractId 置空 → 跳过断言", async () => {
    await updateAsset(admin as never, "a1", {
      attributes: { contractId: null }
    } as never);
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/unit/assets/asset-service-gating.test.ts
```

期望：`createAsset` 未拒绝 EXECUTING 状态的合同 → 失败

- [ ] **Step 3: 改 `assertPerformanceContractAmount` —— 顺手把 `findUnique` 换成 `findFirst`**

`server/services/asset.ts` 当前的 `findUnique({ where: { id, deletedAt: null }})` 在 Prisma 7 严格类型下是 TS 漏洞（`deletedAt` 不在 unique key 里）。这一轮直接换 `findFirst`,新代码不再踩坑。同时把 `select` 扩成 `{ totalAmount, status }` 给断言用:

```ts
// server/services/asset.ts,定位函数体,整段替换
import {
  assertContractStatusForPerformance,
  assertProjectStatusForCase
} from "@/lib/assets/finalized-statuses";

async function assertPerformanceContractAmount(
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  if (type !== "PERFORMANCE") return attributes;
  if (!attributes?.contractId) return attributes;
  const cid = String(attributes.contractId);
  const contract = await prisma.contract.findFirst({
    where: { id: cid, deletedAt: null },
    select: { totalAmount: true, status: true }
  });
  if (!contract) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      "关联的合同不存在或已删除",
      400
    );
  }
  // 状态门禁:仅允许 COMPLETED
  assertContractStatusForPerformance(contract);
  const expected = Number(contract.totalAmount);
  if (attributes.contractAmount == null) {
    return { ...attributes, contractAmount: expected };
  }
  if (Number(attributes.contractAmount) !== expected) {
    const cur = Number(attributes.contractAmount);
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `业绩金额必须等于合同金额(合同金额 ¥${expected.toLocaleString()},当前 ¥${cur.toLocaleString()})`,
      400
    );
  }
  return attributes;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/unit/assets/asset-service-gating.test.ts
```

期望：6 个用例全 PASS（3 create + 3 update）

- [ ] **Step 5: 提交**

```bash
git add server/services/asset.ts tests/unit/assets/asset-service-gating.test.ts
git commit -m "feat(assets): PERFORMANCE create/update 校验合同必须 COMPLETED;findUnique 换 findFirst"
```

---

## Task 3: 服务层接入新断言(CASE 项目)

**Files:**
- Modify: `server/services/asset.ts`（在 `assertPerformanceContractAmount` 旁边新增 `assertFinalizedReferences`；把 createAsset / updateAsset 调用名都换掉）
- Modify: `tests/unit/assets/asset-service-gating.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试(追加到上面那个文件)**

```ts
describe("createAsset · CASE 项目状态门禁", () => {
  it("选了项目但项目 IN_PROGRESS → 抛错", async () => {
    (prisma.project.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "IN_PROGRESS"
    });
    await expect(
      createAsset(admin as never, {
        type: "CASE",
        name: "某案例",
        tags: [],
        attributes: {
          projectId: "pid-1",
          title: "t",
          customerName: "c",
          serviceType: "SAFETY_CONSULT",
          year: 2024,
          scope: "s"
        }
      } as never)
    ).rejects.toThrow(/已验收或已关闭/);
    expect(txMock.companyAsset.create).not.toHaveBeenCalled();
  });

  it.each(["ACCEPTED", "CLOSED"])("CASE 关联 %s 项目 → 放行", async (status) => {
    (prisma.project.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status });
    await createAsset(admin as never, {
      type: "CASE",
      name: "案例",
      tags: [],
      attributes: {
        projectId: "pid-1",
        title: "t",
        customerName: "c",
        serviceType: "SAFETY_CONSULT",
        year: 2024,
        scope: "s"
      }
    } as never);
    expect(txMock.companyAsset.create).toHaveBeenCalled();
  });

  it("CASE 不传 projectId → 跳过断言", async () => {
    await createAsset(admin as never, {
      type: "CASE",
      name: "独立案例",
      tags: [],
      attributes: {
        title: "t",
        customerName: "c",
        serviceType: "SAFETY_CONSULT",
        year: 2024,
        scope: "s"
      }
    } as never);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateAsset · CASE 项目状态门禁", () => {
  it("原项目是 IN_PROGRESS,不改 projectId → 保存失败", async () => {
    txMock.companyAsset.findFirst.mockResolvedValue({
      id: "a1",
      name: "old",
      attributes: { projectId: "pid-old" },
      type: "CASE"
    });
    (prisma.project.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "IN_PROGRESS"
    });
    await expect(
      updateAsset(admin as never, "a1", { description: "x" } as never)
    ).rejects.toThrow(/已验收或已关闭/);
    expect(txMock.companyAsset.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/unit/assets/asset-service-gating.test.ts
```

期望：CASE IN_PROGRESS 用例 FAIL（当前服务层不查 project）

- [ ] **Step 3: 新增 `assertFinalizedReferences` 并把 createAsset / updateAsset 的调用换掉**

在 `server/services/asset.ts` 文件底部、`assertPerformanceContractAmount` 紧邻处新增包装函数:

```ts
/** create/update 入口的统一断言:
 *  - PERFORMANCE:合同必须 COMPLETED + 金额强约束
 *  - CASE:项目必须 ACCEPTED/CLOSED
 *  - 其他 type:穿透
 *  - 不传 contractId/projectId:跳过对应断言(允许"独立业绩/纯文字案例")
 */
async function assertFinalizedReferences(
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  const afterAmount = await assertPerformanceContractAmount(type, attributes);
  if (type !== "CASE" || !afterAmount?.projectId) return afterAmount;
  const pid = String(afterAmount.projectId);
  const project = await prisma.project.findFirst({
    where: { id: pid, deletedAt: null },
    select: { status: true }
  });
  if (!project) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      "关联的项目不存在或已删除",
      400
    );
  }
  assertProjectStatusForCase(project);
  return afterAmount;
}
```

然后两处替换:

`createAsset` 内:

```ts
// 旧
const validatedAttrs = await assertPerformanceContractAmount(data.type, data.attributes as Record<string, unknown>);
// 新
const validatedAttrs = await assertFinalizedReferences(
  data.type,
  data.attributes as Record<string, unknown>
);
```

`updateAsset` 内:

```ts
// 旧
const validatedAttrs = await assertPerformanceContractAmount(
  existing.type,
  candidateMerged
);
// 新
const validatedAttrs = await assertFinalizedReferences(
  existing.type,
  candidateMerged
);
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/unit/assets/asset-service-gating.test.ts
```

期望：全部 PASS（3 create + 3 update + 3 create CASE + 1 update CASE = 10 个）

- [ ] **Step 5: 跑全部资产单元测试,确认没破坏其它资产测试**

```bash
pnpm vitest run tests/unit/assets/
```

期望：PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/asset.ts tests/unit/assets/asset-service-gating.test.ts
git commit -m "feat(assets): CASE create/update 校验项目必须已验收或已关闭"
```

---

## Task 4: 导入路径走同一套断言（bulkImportAssets 单元测）

**Files:**
- Modify: `server/services/asset-import.ts`（在 `bulkImportAssets` 循环里 create 之前调断言；行号带中文报错）
- Create: `tests/unit/assets/asset-import-gating.test.ts`

- [ ] **Step 1: 写失败测试（直接对 `bulkImportAssets` 服务层做 vi.mock）**

```ts
// tests/unit/assets/asset-import-gating.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const txMock = {
  companyAsset: { create: vi.fn() },
  contract: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() }
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(txMock),
    companyAsset: { findFirst: vi.fn() }
  }
}));
vi.mock("@/lib/rls", () => ({}));
vi.mock("@/lib/sequence", () => ({
  nextBusinessNo: vi.fn().mockResolvedValue("QT-ASSET-2026-0001")
}));
vi.mock("@/lib/permissions", () => ({
  requirePermission: vi.fn(),
  RESOURCE: { ASSET: "ASSET" },
  ACTION: { CREATE: "CREATE", READ: "READ", UPDATE: "UPDATE", DELETE: "DELETE" }
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assets/status", () => ({
  computeAssetStatus: () => "VALID"
}));

import { bulkImportAssets } from "@/server/services/asset-import";
import { ApiError } from "@/lib/api";

const admin = { id: "u1", roleCode: "ADMIN" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  txMock.companyAsset.create.mockResolvedValue({ id: "a1" });
});

describe("bulkImportAssets · 入库门禁", () => {
  it("PERFORMANCE 行合同 EXECUTING → 整批回滚 + 中文报错带行号", async () => {
    txMock.contract.findFirst.mockResolvedValue({ status: "EXECUTING", totalAmount: 100 });
    const rows = [{
      rowIndex: 2,
      parsed: {
        type: "PERFORMANCE" as const,
        name: "x",
        tags: [],
        attributes: {
          projectName: "p",
          customerName: "c",
          serviceType: "SAFETY_CONSULT" as const,
          contractAmount: 100,
          contractId: "cid-1"
        }
      },
      values: {},
      errors: []
    }];
    await expect(
      bulkImportAssets(admin as never, "PERFORMANCE", rows as never)
    ).rejects.toThrow(/第 2 行.*已完成的合同/);
    expect(txMock.companyAsset.create).not.toHaveBeenCalled();
  });

  it("PERFORMANCE 行合同 COMPLETED → 整批提交", async () => {
    txMock.contract.findFirst.mockResolvedValue({ status: "COMPLETED", totalAmount: 100 });
    const rows = [{
      rowIndex: 2,
      parsed: {
        type: "PERFORMANCE" as const,
        name: "x",
        tags: [],
        attributes: {
          projectName: "p",
          customerName: "c",
          serviceType: "SAFETY_CONSULT" as const,
          contractAmount: 100,
          contractId: "cid-1"
        }
      },
      values: {},
      errors: []
    }];
    await bulkImportAssets(admin as never, "PERFORMANCE", rows as never);
    expect(txMock.companyAsset.create).toHaveBeenCalledTimes(1);
  });

  it("CASE 行项目 IN_PROGRESS → 整批回滚", async () => {
    txMock.project.findFirst.mockResolvedValue({ status: "IN_PROGRESS" });
    const rows = [{
      rowIndex: 3,
      parsed: {
        type: "CASE" as const,
        name: "x",
        tags: [],
        attributes: {
          projectId: "pid-1",
          title: "t",
          customerName: "c",
          serviceType: "SAFETY_CONSULT" as const,
          year: 2024,
          scope: "s"
        }
      },
      values: {},
      errors: []
    }];
    await expect(
      bulkImportAssets(admin as never, "CASE", rows as never)
    ).rejects.toThrow(/第 3 行.*已验收或已关闭/);
    expect(txMock.companyAsset.create).not.toHaveBeenCalled();
  });

  it("CASE 行项目 ACCEPTED → 放行", async () => {
    txMock.project.findFirst.mockResolvedValue({ status: "ACCEPTED" });
    const rows = [{
      rowIndex: 2,
      parsed: {
        type: "CASE" as const,
        name: "x",
        tags: [],
        attributes: {
          projectId: "pid-1",
          title: "t",
          customerName: "c",
          serviceType: "SAFETY_CONSULT" as const,
          year: 2024,
          scope: "s"
        }
      },
      values: {},
      errors: []
    }];
    await bulkImportAssets(admin as never, "CASE", rows as never);
    expect(txMock.companyAsset.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/unit/assets/asset-import-gating.test.ts
```

期望：2 个拒绝用例 FAIL（当前 `bulkImportAssets` 不查合同/项目状态）

- [ ] **Step 3: 在 `bulkImportAssets` 循环里 create 之前插两段断言**

打开 `server/services/asset-import.ts`,在循环里 `tx.companyAsset.create(...)` 之前插入:

```ts
// 顶部 import 增加
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import {
  assertContractStatusForPerformance,
  assertProjectStatusForCase
} from "@/lib/assets/finalized-statuses";

// 在 bulkImportAssets 的 for 循环里,create 之前:
const attrs = parsed.parsed.attributes as Record<string, unknown>;
if (parsed.parsed.type === "PERFORMANCE" && attrs?.contractId) {
  const c = await tx.contract.findFirst({
    where: { id: String(attrs.contractId), deletedAt: null },
    select: { totalAmount: true, status: true }
  });
  if (!c) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `第 ${parsed.rowIndex} 行:关联的合同不存在或已删除`,
      400
    );
  }
  // 金额强约束沿用 createAsset 同样的规则(选了合同则必须等于合同金额)
  if (attrs.contractAmount != null && Number(attrs.contractAmount) !== Number(c.totalAmount)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `第 ${parsed.rowIndex} 行:业绩金额必须等于合同金额(合同金额 ¥${Number(c.totalAmount).toLocaleString()},当前 ¥${Number(attrs.contractAmount).toLocaleString()})`,
      400
    );
  }
  assertContractStatusForPerformance(c);
}
if (parsed.parsed.type === "CASE" && attrs?.projectId) {
  const p = await tx.project.findFirst({
    where: { id: String(attrs.projectId), deletedAt: null },
    select: { status: true }
  });
  if (!p) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `第 ${parsed.rowIndex} 行:关联的项目不存在或已删除`,
      400
    );
  }
  assertProjectStatusForCase(p);
}
```

> 故意**不复用** `assertFinalizedReferences`:`bulkImportAssets` 在事务里需要 `tx.contract` / `tx.project` 拿到事务一致性读,而 `assertFinalizedReferences` 写死 `prisma.xxx`。统一调用是 nice-to-have,不在本轮目标里,Self-Review 列出。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/unit/assets/asset-import-gating.test.ts
```

期望：4 个用例全 PASS

- [ ] **Step 5: 跑全部资产单元测试**

```bash
pnpm vitest run tests/unit/assets/
```

期望：PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/asset-import.ts tests/unit/assets/asset-import-gating.test.ts
git commit -m "feat(assets): 批量导入在 create 前校验合同/项目状态,行号带中文报错"
```

---

## Task 5: 收紧 PERFORMANCE 合同 picker 的查询状态

**Files:**
- Modify: `components/assets/asset-type-fields.tsx:201`（ContractPicker request 内 `status` 参数）

- [ ] **Step 1: 改 ContractPicker 的 status 过滤**

定位到 `components/assets/asset-type-fields.tsx` 中 `ContractPicker` 的 `request` 函数,找到:

```ts
qs.set("status", "EFFECTIVE,EXECUTING,COMPLETED");
```

改为:

```ts
qs.set("status", PERFORMANCE_ALLOWED_CONTRACT_STATUSES.join(","));
```

并在文件顶部 import 增加:

```ts
import { PERFORMANCE_ALLOWED_CONTRACT_STATUSES } from "@/lib/assets/finalized-statuses";
```

- [ ] **Step 2: 在 picker 的 placeholder 里说明规则**

定位到 ContractPicker 的 `placeholder`,改为:

```ts
placeholder={customerId ? "搜索已完成(COMPLETED)的合同" : "请先选择客户"}
```

- [ ] **Step 3: 跑 typecheck**

```bash
pnpm exec tsc --noEmit
```

期望:无 error

- [ ] **Step 4: 提交**

```bash
git add components/assets/asset-type-fields.tsx
git commit -m "feat(assets-ui): PERFORMANCE 合同 picker 只显示 COMPLETED"
```

---

## Task 6: 收紧 CASE 项目 picker 的查询状态

**Files:**
- Modify: `components/assets/asset-type-fields.tsx:344`（ProjectPicker request 内 `status` 参数）

- [ ] **Step 1: 改 ProjectPicker 的 status 过滤**

定位到 `components/assets/asset-type-fields.tsx` 中 `ProjectPicker` 的 `request`,在 `qs.set("pageSize", "50")` 之后加一行,并加 import:

```ts
import { CASE_ALLOWED_PROJECT_STATUSES } from "@/lib/assets/finalized-statuses";
```

```ts
qs.set("status", CASE_ALLOWED_PROJECT_STATUSES.join(","));
```

- [ ] **Step 2: 在 placeholder 里说明**

```ts
placeholder="搜索已验收/已关闭的项目"
```

> 顺带提一下:ProjectPicker 的 `useEffect` 自动回填路径仍用 `/api/projects?keyword=&pageSize=50` 不带 `status` 过滤。**无功能影响**(因为 picker 限制用户只能选白名单内项目),只是少量浪费查询。**不在本轮修**。

- [ ] **Step 3: 跑 typecheck**

```bash
pnpm exec tsc --noEmit
```

期望:无 error

- [ ] **Step 4: 提交**

```bash
git add components/assets/asset-type-fields.tsx
git commit -m "feat(assets-ui): CASE 项目 picker 只显示 ACCEPTED/CLOSED"
```

---

## Task 7: 用户手册文档化新规则

**Files:**
- Modify: `docs/USER_MANUAL.md`（新增 13.x 小节）

- [ ] **Step 1: 追加小节到第 13 章末尾**

不动章号。在 `### 13.x` 之后追加（如果有现成的"### 13.x"标题,改个数字避免冲突):

```markdown
#### 入库前置条件（资产库 v1.1 起生效）

| 资产类型 | 关联合同/项目 | 允许状态 |
|---|---|---|
| 业绩证明 (PERFORMANCE) | `attributes.contractId` 关联的合同 | `COMPLETED`(已完成) |
| 项目案例 (CASE) | `attributes.projectId` 关联的项目 | `ACCEPTED`(已验收)、`CLOSED`(已关闭) |

- 不传 `contractId` / `projectId` 时跳过校验,允许"独立业绩"和"纯文字案例"的旧用法
- 表单 picker 已按白名单过滤,看不到未完成的合同/项目
- 服务端会二次校验（防绕过）;若合同/项目被硬删,导入与 API 直调都会返回 400
- **存量数据**：规则生效前录入的、关联到非白名单合同/项目的资产继续可查;**编辑保存时**必须把 `contractId`/`projectId` 改到白名单内或置空,否则 400
- 批量导入：任意一行触发门禁 → 整批回滚 + 错误信息带 Excel 行号
```

- [ ] **Step 2: 提交**

```bash
git add docs/USER_MANUAL.md
git commit -m "docs(assets): 用户手册记录合同/项目完成态入库门禁"
```

---

## Task 8: 手工 QA(Mandatory Gate)

按 `superpowers:verification-before-completion` 走一遍真实路径,不能只靠单测。

- [ ] **Step 1: 启动 dev server**

```bash
pnpm dev
```

- [ ] **Step 2: 准备测试数据**

```bash
# 用 prisma studio 准备:
#   - 1 个 COMPLETED 合同、1 个 EXECUTING 合同（同一客户）
#   - 1 个 ACCEPTED 项目、1 个 IN_PROGRESS 项目
#   - 1 条 存量 PERFORMANCE（contractId 指 EXECUTING 那笔）
#   - 1 条 存量 CASE（projectId 指 IN_PROGRESS 那笔）
pnpm exec prisma studio
```

- [ ] **Step 3: 浏览器走 4 条新建路径**

访问 `http://localhost:3000/assets/new`,选 PERFORMANCE:

1. 选客户 → 合同 picker 应该只列出 `COMPLETED`;`EXECUTING` 看不到
2. 不选合同,直接填业绩,提交 → 应成功
3. **绕过前端**：用 curl 携带 `EXECUTING` 合同的 contractId POST `/api/assets` → 应得 400 `业绩证明只能关联已完成的合同`

切到 CASE,重复上述 3 步（状态换成 ACCEPTED / IN_PROGRESS,期望一致）。

- [ ] **Step 4: 浏览器走 2 条存量编辑路径（关键风险路径）**

打开**存量 PERFORMANCE**（绑的是 EXECUTING 合同）:

1. 不改任何字段,直接保存 → 应得 400 + 中文提示"业绩证明只能关联已完成的合同(当前合同状态:EXECUTING)"
2. 清空 `contractId` 字段 → 保存 → 应成功（变成"独立业绩"）
3. 改成 COMPLETED 合同 → 保存 → 应成功

打开**存量 CASE**（绑的是 IN_PROGRESS 项目）,重复 1-3。

- [ ] **Step 5: 走批量导入路径**

1. 在导入模板的 PERFORMANCE sheet 填一行,`contractId` 写 EXECUTING 合同
2. 选 PERFORMANCE 类型上传 xlsx → 应得整批回滚,错误信息含行号 + 合同状态

- [ ] **Step 6: 跑完整 vitest**

```bash
pnpm vitest run
```

期望:全 PASS

- [ ] **Step 7: 跑 typecheck**

```bash
pnpm exec tsc --noEmit
```

期望:无 error

- [ ] **Step 8: 在最终回复里列:做了哪些、验证了什么、什么没法在本地验证**

---

## Self-Review(写完计划后的自查)

**Spec 覆盖:**
- [x] PERFORMANCE 合同白名单 `COMPLETED` → Task 1 常量、Task 2 服务层、Task 4 导入、Task 5 picker
- [x] CASE 项目白名单 `ACCEPTED`/`CLOSED` → Task 1 常量、Task 3 服务层、Task 4 导入、Task 6 picker
- [x] 不传 ID 跳过断言 → Task 2/3 测试用例、Task 1 helper 注释
- [x] 存量数据兼容(只读)→ Task 0 数据观察、Task 7 文档、Task 8 step 4 编辑路径
- [x] 导入路径同样校验 → Task 4
- [x] 用户手册更新 → Task 7
- [x] `findUnique` 改 `findFirst` 修预存在 TS 漏洞 → Task 2 step 3

**占位符扫描:** 全文没有 "TBD / TODO / 实现稍后 / 类似 Task N"。Task 6 step 2 的"useEffect 不带 status 过滤"是显式标注的"不在本轮修"。

**类型一致性:**
- `assertContractStatusForPerformance` / `assertProjectStatusForCase` 在 Task 1 定义,Task 2/3/4 都按这个签名调用
- `PERFORMANCE_ALLOWED_CONTRACT_STATUSES` / `CASE_ALLOWED_PROJECT_STATUSES` 在 Task 1 定义,Task 5/6 用 `join(",")` 喂给 `?status=`,Task 2/3/4 内部用 `.includes()` 判断
- Task 1 的 helper 用 `ContractStatus` / `ProjectStatus` 强类型,新增枚举值会在编译期被这里接住

**已知偏差（Self-Review 自报）:**
- Task 4 故意不复用 `assertFinalizedReferences`:bulkImportAssets 在事务里需要 `tx.contract.findFirst` 拿到一致性读,helper 写死 `prisma.xxx`。统一调用是 nice-to-have,留给后续重构
- Task 0 是部署前置任务,应**先**于 Task 1-7 执行;但放在文档最前是因为它是"风险评估",不上线前必须完成

**回滚路径:** 全部改动集中在 Task 1 引入的常量(白名单)。如上线后业务侧反悔,改 `PERFORMANCE_ALLOWED_CONTRACT_STATUSES` / `CASE_ALLOWED_PROJECT_STATUSES` 即可,无需 revert 代码。`findUnique`→`findFirst` 是行为等价修复,无回滚必要。

**开放问题(留给执行者):**
- 是否把 `EXECUTING`(在执行中)算作"业绩可入库"?当前按"完成"语义严格不放行。改 `PERFORMANCE_ALLOWED_CONTRACT_STATUSES` 一行
- 是否把 `DELIVERED`(已交付,未验收)算作"案例可入库"?同上,改 `CASE_ALLOWED_PROJECT_STATUSES` 一行

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-asset-finalized-gating.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
