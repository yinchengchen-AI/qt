// createContract 的 ownerUserId 默认值规则回归
// 关键业务规则 (P1-1 修复):
//   - 前端不传 ownerUserId:
//       SALES / EXPERT: 默认 = user.id   (合同 owner = 创建人)
//       ADMIN:         默认 = customer.ownerUserId (代理创建场景, 沿用客户 owner)
//   - 前端显式传 ownerUserId: 用前端值, 但走 assertActiveUser 校验
//
// 不连真实 DB, 用 vi.mock 拦截 prisma, 在 assertActiveUser 内抓 user.findFirst 的
// where 来反推 ownerUserId 默认值. 6 个 case 覆盖完整矩阵.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  // 每次 assertActiveUser / contract.findFirst 等调用时记录
  userFindFirstWhere: null as null | Record<string, unknown>,
  customerReturned: null as null | { id: string; ownerUserId: string }
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dictionary: {
      findUnique: vi.fn(async () => ({ id: "dict-1" })) // serviceType 校验通过
    },
    customer: {
      findFirst: vi.fn(async () => mockState.customerReturned)
    },
    user: {
      // assertActiveUser 内的 user.findFirst
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        mockState.userFindFirstWhere = args.where;
        // 任意 user 都视为 ACTIVE, 让 assertActiveUser 通过
        return { id: "u-x", status: "ACTIVE" };
      })
    },
    contract: {
      // 合同编号查重
      findFirst: vi.fn(async () => null),
      // createContract 末尾的 findUnique
      findUnique: vi.fn(async () => ({ id: "c-1", status: "DRAFT" })),
      // 事务内的 create
      create: vi.fn(async () => ({ id: "c-1" })),
      update: vi.fn(async () => ({ id: "c-1" })),
      // tryAutoPublish 内的 findFirst
      // 不走 auto-publish 时不需要, 留兜底
      count: vi.fn(async () => 0)
    },
    // rlsTransaction 之外 (ownerUserId 默认值不依赖 RLS, 不会真跑)
    // 但 customer 端要绕开, 用 prisma.$transaction 模拟: 立刻执行 callback
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        contract: {
          create: vi.fn(async () => ({ id: "c-1" })),
          update: vi.fn(async () => ({ id: "c-1" })),
          findFirst: vi.fn(async () => null)
        },
        contractReviewLog: { create: vi.fn(async () => ({})) },
        operationLog: { create: vi.fn(async () => ({})) }
      };
      return fn(tx);
    })
  }
}));

// 必须放在 mock 之后 import, 否则拿不到被 mock 的 prisma
import { createContract } from "@/server/services/contract";
import type { ContractCreateInput } from "@/lib/validators/contract";

const SALES = {
  id: "u-sales",
  employeeNo: "S1",
  name: "Sales",
  email: null,
  phone: null,
  roleCode: "SALES"
} as unknown as Parameters<typeof createContract>[0];

const EXPERT = { ...SALES, id: "u-expert", roleCode: "EXPERT" } as unknown as Parameters<typeof createContract>[0];
const ADMIN = { ...SALES, id: "u-admin", roleCode: "ADMIN" } as unknown as Parameters<typeof createContract>[0];

const CUSTOMER_OWNER = "u-customer-owner";

function baseInput(): ContractCreateInput {
  return {
    customerId: "cust-1",
    contractNo: `TEST-${Date.now()}-${Math.random()}`,
    title: "t",
    serviceType: "OTHER",
    signDate: "2026-01-01T00:00:00.000Z",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    totalAmount: 10000,
    taxRate: 0.06,
    paymentMethod: "LUMP_SUM",
    attachments: []
  };
}

beforeEach(() => {
  mockState.userFindFirstWhere = null;
  mockState.customerReturned = {
    id: "cust-1",
    ownerUserId: CUSTOMER_OWNER
  };
});

// 验证 ownerUserId 的方法: assertActiveUser 内会调 user.findFirst({ where: { id, ... } }),
// 从 where.id 反推 ownerUserId 默认值.
function getResolvedOwnerId(): string | null {
  const w = mockState.userFindFirstWhere as { id?: string } | null;
  return w?.id ?? null;
}

describe("createContract - ownerUserId 默认值规则 (P1-1)", () => {
  it("SALES 不传 ownerUserId → 默认 = SALES 自己的 id", async () => {
    await createContract(SALES, baseInput());
    expect(getResolvedOwnerId()).toBe("u-sales");
  });

  it("EXPERT 不传 ownerUserId → 默认 = EXPERT 自己的 id", async () => {
    await createContract(EXPERT, baseInput());
    expect(getResolvedOwnerId()).toBe("u-expert");
  });

  it("ADMIN 不传 ownerUserId → 默认沿用 customer.ownerUserId", async () => {
    await createContract(ADMIN, baseInput());
    expect(getResolvedOwnerId()).toBe(CUSTOMER_OWNER);
  });

  it("SALES 显式传 ownerUserId → 用前端值, 不退回 customer owner", async () => {
    await createContract(SALES, { ...baseInput(), ownerUserId: "u-override" });
    expect(getResolvedOwnerId()).toBe("u-override");
  });

  it("ADMIN 显式传 ownerUserId → 用前端值, 不退回 customer owner", async () => {
    await createContract(ADMIN, { ...baseInput(), ownerUserId: "u-override" });
    expect(getResolvedOwnerId()).toBe("u-override");
  });

  it("EXPERT 显式传 ownerUserId = 自己 → 用前端值, 仍为自己", async () => {
    await createContract(EXPERT, { ...baseInput(), ownerUserId: "u-expert" });
    expect(getResolvedOwnerId()).toBe("u-expert");
  });
});
