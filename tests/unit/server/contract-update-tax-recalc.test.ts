// updateContract 税额重算并发一致性单元测试 (P1 修复)
//
// 场景: existing 在事务外读取 (totalAmount=10000), 并发 PATCH A 先把总额改成 20000 并提交;
//       本请求 (PATCH B) 只改税率。修复前税额重算用事务外 existing.totalAmount=10000,
//       落库的 taxAmount/amountExcludingTax 与最终 totalAmount=20000 不一致。
// 修复后: 重算必须以事务内 locked 行 (totalAmount=20000) 为基准。
//
// 不连真实 DB, 用 vi.mock 拦截 prisma; tx.contract.update 第一次调用是锁行 (返回 locked),
// 第二次是真正的业务 update, 从第二次调用的 data 里抓 taxAmount 验证基准值。
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { updateContract } from "@/server/services/contract";
import { calcTaxBreakdown } from "@/lib/money";
import type { SessionUser } from "@/lib/session";
import type { ContractUpdateInput } from "@/lib/validators/contract";

const ADMIN: SessionUser = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: "admin@dev.local",
  roleCode: "ADMIN",
  permissions: [],
};

// 事务外快照: 并发 A 提交前的旧值
const STALE_TOTAL = new Prisma.Decimal(10000);
// 事务内 locked 行: 并发 A 已提交后的新值
const LOCKED_TOTAL = new Prisma.Decimal(20000);

const captured = {
  updateData: null as Record<string, unknown> | null,
};

function makeMockTx() {
  let updateCall = 0;
  return {
    contract: {
      update: vi.fn(async (args: { data?: Record<string, unknown>; select?: unknown }) => {
        updateCall++;
        if (updateCall === 1) {
          // 锁行: select 出来的 locked 快照 (并发 A 已经提交 totalAmount=20000)
          return {
            id: "c-1",
            status: "ACTIVE",
            contractNo: "TEST-C-001",
            title: "t",
            serviceType: "OTHER",
            signDate: new Date("2026-01-01"),
            startDate: new Date("2026-01-01"),
            endDate: new Date("2026-12-31"),
            totalAmount: LOCKED_TOTAL,
            taxRate: new Prisma.Decimal("0.06"),
            taxAmount: new Prisma.Decimal("1132.08"),
            amountExcludingTax: new Prisma.Decimal("18867.92"),
            paymentMethod: "LUMP_SUM",
            ownerUserId: "u-admin",
            remark: null,
            installmentPlan: null,
          };
        }
        // 业务 update: 抓 data 验证, 返回行 = locked + 应用的变更
        captured.updateData = args.data ?? null;
        return {
          id: "c-1",
          status: "ACTIVE",
          contractNo: "TEST-C-001",
          title: "t",
          serviceType: "OTHER",
          signDate: new Date("2026-01-01"),
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
          totalAmount: LOCKED_TOTAL,
          taxRate: new Prisma.Decimal("0.13"),
          taxAmount: args.data?.taxAmount,
          amountExcludingTax: args.data?.amountExcludingTax,
          paymentMethod: "LUMP_SUM",
          ownerUserId: "u-admin",
          remark: null,
          installmentPlan: null,
        };
      }),
    },
    operationLog: { create: vi.fn(async () => ({})) },
  } as unknown as Prisma.TransactionClient;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockTx())),
    contract: {
      // 事务外 existing: 旧快照 totalAmount=10000 (并发 A 尚未提交时读到的)
      findFirst: vi.fn(async () => ({
        id: "c-1",
        status: "ACTIVE",
        contractNo: "TEST-C-001",
        customerId: "cust-1",
        signerId: "u-admin",
        ownerUserId: "u-admin",
        title: "t",
        serviceType: "OTHER",
        signDate: new Date("2026-01-01"),
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        totalAmount: STALE_TOTAL,
        taxRate: new Prisma.Decimal("0.06"),
        taxAmount: new Prisma.Decimal("566.04"),
        amountExcludingTax: new Prisma.Decimal("9433.96"),
        paymentMethod: "LUMP_SUM",
        remark: null,
        installmentPlan: null,
        attachments: [],
      })),
    },
  },
}));

describe("updateContract - 税额重算以事务内 locked 行为基准", () => {
  it("只改税率时, taxAmount 按 locked.totalAmount (20000) 重算, 不是事务外快照 (10000)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const txMock = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementationOnce((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    const input: ContractUpdateInput = { taxRate: 0.13 };
    await updateContract(ADMIN, "c-1", input);

    expect(captured.updateData).not.toBeNull();
    const expected = calcTaxBreakdown(LOCKED_TOTAL, "0.13");
    // 修复前这里会是 calcTaxBreakdown(10000, 0.13) 的结果 → 落库不一致
    expect(String(captured.updateData!.taxAmount)).toBe(expected.taxAmount.toString());
    expect(String(captured.updateData!.amountExcludingTax)).toBe(expected.amountExcludingTax.toString());
  });
});
