// updateContract 总额调小不变式单元测试
// 覆盖: ADMIN 调小 totalAmount 时, 已有发票/回款超出新总额应被拦截.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { updateContract } from "@/server/services/contract";
import { ERROR_CODES } from "@/types/errors";
import type { ContractUpdateInput } from "@/lib/validators/contract";
import type { SessionUser } from "@/lib/session";

const ADMIN: SessionUser = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: "admin@dev.local",
  roleCode: "ADMIN",
  permissions: [],
};

// 追踪事务内查询到的聚合值, 用于断言校验逻辑确实执行
const captured = {
  invoiceStatuses: null as string[] | null,
  paymentStatuses: null as string[] | null,
};

function makeMockTx(
  opts: {
    invoicedSum?: number | string;
    paidSum?: number | string;
  } = {}
) {
  return {
    invoice: {
      aggregate: vi.fn(async ({ where }: { where: { status?: { in: string[] } } }) => {
        captured.invoiceStatuses = where.status?.in ?? null;
        return { _sum: { amount: opts.invoicedSum ?? 0 } };
      }),
    },
    payment: {
      aggregate: vi.fn(async ({ where }: { where: { status?: { in: string[] } } }) => {
        captured.paymentStatuses = where.status?.in ?? null;
        return { _sum: { amount: opts.paidSum ?? 0 } };
      }),
    },
    contract: {
      update: vi.fn(async () => ({
        id: "c-1",
        status: "ACTIVE",
        totalAmount: new Prisma.Decimal(1000),
        taxAmount: new Prisma.Decimal(0),
        amountExcludingTax: new Prisma.Decimal(1000),
      })),
    },
    attachment: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  } as unknown as Prisma.TransactionClient;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockTx())),
    contract: {
      findFirst: vi.fn(async () => ({
        id: "c-1",
        status: "ACTIVE",
        totalAmount: new Prisma.Decimal(10000),
        taxAmount: new Prisma.Decimal(0),
        amountExcludingTax: new Prisma.Decimal(10000),
        taxRate: 0,
        contractNo: "TEST-C-001",
        customerId: "cust-1",
        signerId: "u-admin",
        ownerUserId: "u-admin",
        signDate: new Date(),
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        installmentPlan: [],
        attachments: [],
      })),
    },
  },
}));

// 每次测试重置事务 mock, 因为 $transaction 在模块加载时已被 mock 成固定函数
beforeEach(() => {
  captured.invoiceStatuses = null;
  captured.paymentStatuses = null;
});

function baseInput(): ContractUpdateInput {
  return {
    title: "更新后标题",
  };
}

describe("updateContract - totalAmount 调小不变式", () => {
  it("totalAmount 不变时不校验聚合", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await updateContract(ADMIN, "c-1", baseInput());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((txMock as any).invoice.aggregate).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((txMock as any).payment.aggregate).not.toHaveBeenCalled();
  });

  it("totalAmount 调大时不校验聚合", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 20000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((txMock as any).invoice.aggregate).not.toHaveBeenCalled();
  });

  it("totalAmount 调小且已开票未超新总额 → 允许", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx({ invoicedSum: 5000, paidSum: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    const r = await updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 6000 });
    expect(r).toBeDefined();
    expect(captured.invoiceStatuses).toEqual(["DRAFT", "ISSUED", "RED_FLUSHED"]);
    expect(captured.paymentStatuses).toEqual(["CONFIRMED", "RECONCILED"]);
  });

  it("totalAmount 调小但已开票超过新总额 → 抛 INVOICE_OVER_LIMIT", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx({ invoicedSum: 8000, paidSum: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await expect(
      updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 6000 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT, status: 422 });
  });

  it("totalAmount 调小但已回款超过新总额 → 抛 PAYMENT_OVER_CONTRACT", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx({ invoicedSum: 0, paidSum: 8000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await expect(
      updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 6000 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_CONTRACT, status: 422 });
  });

  it("容差内(新总额 + 0.01)不拦截", async () => {
    const { prisma } = await import("@/lib/prisma");
    // 新总额 6000, 已开票 6000.01 → 在 0.01 容差内, 不应拦截
    const txMock = makeMockTx({ invoicedSum: "6000.01", paidSum: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    const r = await updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 6000 });
    expect(r).toBeDefined();
  });

  it("容差外(新总额 + 0.02)拦截", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx({ invoicedSum: "6000.02", paidSum: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await expect(
      updateContract(ADMIN, "c-1", { ...baseInput(), totalAmount: 6000 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT });
  });
});
