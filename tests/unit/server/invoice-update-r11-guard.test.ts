// updateInvoice 降额 R-11 守卫单元测试
// 覆盖: 改小金额时, 已关联回款超出新金额应被拦截; 改大或不变不触发此守卫.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { updateInvoice } from "@/server/services/invoice";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";

const ADMIN: SessionUser = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: "admin@dev.local",
  roleCode: "ADMIN",
  permissions: [],
};

// 追踪事务内调用: 确认 R-11 复检真的跑了
const captured = {
  paymentAggregateCalls: 0,
  paymentOrBranches: [] as Array<Array<Record<string, unknown>>>,
};

function makeMockTx(opts: { paymentSum?: number | string; updatedCount?: number } = {}) {
  return {
    $queryRaw: vi.fn(async () => [
      { totalAmount: new Prisma.Decimal(10000) } // FOR UPDATE 返回合同总额
    ]),
    invoice: {
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      update: vi.fn(async () => ({
        id: "inv-1",
        amount: new Prisma.Decimal(100),
        taxRate: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        amountExcludingTax: new Prisma.Decimal(100),
        status: "DRAFT",
      })),
    },
    payment: {
      aggregate: vi.fn(async ({ where }: { where: { OR?: Array<Record<string, unknown>> } }) => {
        captured.paymentAggregateCalls += 1;
        const ors = (where && where.OR) ?? [];
        captured.paymentOrBranches.push(ors);
        return { _sum: { amount: opts.paymentSum ?? 0 } };
      }),
      updateMany: vi.fn(async () => ({ count: opts.updatedCount ?? 0 })),
    },
    attachment: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  } as unknown as Prisma.TransactionClient;
}

// 模块级 mock: prisma.invoice.findFirst 在事务外读 invoice 快照
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(undefined)),
    invoice: {
      findFirst: vi.fn(async () => ({
        id: "inv-1",
        invoiceNo: "TEST-I-001",
        contractId: "c-1",
        status: "DRAFT",
        amount: new Prisma.Decimal(1000),
        taxRate: new Prisma.Decimal(0.06),
        taxAmount: new Prisma.Decimal("56.60"),
        amountExcludingTax: new Prisma.Decimal("943.40"),
        contract: { ownerUserId: "u-admin" },
      })),
    },
  },
}));

beforeEach(() => {
  captured.paymentAggregateCalls = 0;
  captured.paymentOrBranches = [];
});

describe("updateInvoice - 降额 R-11 守卫", () => {
  it("改大金额: 不应触发 R-11 复检", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await updateInvoice(ADMIN, "inv-1", { amount: 2000 });
    // R-08 复检跑(R-08 无条件执行), 但 updateInvoice 当前的"newAmount < inv.amount"分支
    // 应不进入 — 我们用 paymentAggregateCalls == 0 验证
    expect(captured.paymentAggregateCalls).toBe(0);
  });

  it("降额且已回款超过新金额 → 抛 PAYMENT_OVER_INVOICE", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx({ paymentSum: 800 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await expect(
      updateInvoice(ADMIN, "inv-1", { amount: 500 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_INVOICE, status: 422 });
    // R-11 复检跑了一次
    expect(captured.paymentAggregateCalls).toBe(1);
    // 口径: OR 分支含 CONFIRMED/RECONCILED 与 手工 PLANNED(非 -PLANNED 后缀)
    const ors = captured.paymentOrBranches[0] ?? [];
    expect(ors.length).toBeGreaterThanOrEqual(2);
  });

  it("降额但已回款在容差内 → 允许", async () => {
    const { prisma } = await import("@/lib/prisma");
    // 新金额 500, 已回款 500.01 (= 500 + TOL) → 不应拦截
    const within = (500 + Number(MONEY_TOLERANCE.toString())).toString();
    const txMock = makeMockTx({ paymentSum: within });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    const r = await updateInvoice(ADMIN, "inv-1", { amount: 500 });
    expect(r).toBeDefined();
  });

  it("降额但已回款超容差 → 拦截", async () => {
    const { prisma } = await import("@/lib/prisma");
    // 新金额 500, 已回款 500.02 (> 500 + TOL) → 拦截
    const txMock = makeMockTx({ paymentSum: "500.02" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await expect(
      updateInvoice(ADMIN, "inv-1", { amount: 500 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_INVOICE });
  });

  it("不变金额: 不应触发 R-11 复检", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await updateInvoice(ADMIN, "inv-1", { titleName: "不改金额" });
    expect(captured.paymentAggregateCalls).toBe(0);
  });
});
