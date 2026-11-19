// C2 / H1 行级隔离回归
//
//   C2: EXPERT 角色此前零隔离 (ownership.ts 只判 SALES), 可读/改/导出全公司数据。
//       修复后 ownerEq/ownerViaContract 对 SALES + EXPERT 都注入 ownerUserId = 自己。
//   H1: getInvoiceAging 的 query.ownerUserId 入参此前用对象展开**覆盖**隔离条件,
//       SALES 传他人 id 即可看/导出他人账龄。修复后受限角色强制等于自己。
//
// DB 不可达时账龄用例 skip; ownership 助手的纯函数用例不依赖 DB 始终可跑。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ownerEq, ownerViaContract, isRowRestricted } from "@/lib/ownership";
import { getInvoiceAging, getInvoiceAgingBuckets } from "@/server/services/statistics";

function mkUser(roleCode: SessionUser["roleCode"], id = `user-${roleCode.toLowerCase()}`): SessionUser {
  return { id, employeeNo: id, name: id, email: `${id}@t.local`, roleCode, permissions: [] };
}

describe("C2: ownership 助手对 SALES + EXPERT 都隔离", () => {
  it("SALES 与 EXPERT 均判定为受限角色", () => {
    expect(isRowRestricted(mkUser("SALES"))).toBe(true);
    expect(isRowRestricted(mkUser("EXPERT"))).toBe(true);
  });

  it("ADMIN / FINANCE / OPS 不受限", () => {
    expect(isRowRestricted(mkUser("ADMIN"))).toBe(false);
    expect(isRowRestricted(mkUser("FINANCE"))).toBe(false);
    expect(isRowRestricted(mkUser("OPS"))).toBe(false);
  });

  it("ownerEq: EXPERT 也注入自己的 ownerUserId (此前是 {} 零过滤)", () => {
    const expert = mkUser("EXPERT", "expert-1");
    expect(ownerEq(expert)).toEqual({ ownerUserId: "expert-1" });
    expect(ownerEq(mkUser("SALES", "sales-1"))).toEqual({ ownerUserId: "sales-1" });
    expect(ownerEq(mkUser("ADMIN"))).toEqual({});
  });

  it("ownerViaContract: EXPERT 也注入 contract.ownerUserId", () => {
    const expert = mkUser("EXPERT", "expert-2");
    expect(ownerViaContract(expert)).toEqual({ contract: { ownerUserId: "expert-2" } });
    expect(ownerViaContract(mkUser("FINANCE"))).toEqual({});
  });
});

describe("H1: getInvoiceAging 越权 (SALES 传他人 ownerUserId)", () => {
  let dbReachable = false;
  let salesId: string | null = null;
  let otherId: string | null = null;
  let selfInvoiceId: string | null = null;
  let otherInvoiceId: string | null = null;
  const tag = `TEST-OWNERSHIP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdUserIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdContractIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const expectedBuckets = { "0-30": 0, "31-60": 600, "61-90": 0, "90+": 0 };

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const fixtures = [
      { suffix: "self", invoiceAmount: 1000, paymentAmount: 400, daysAgo: 45 },
      { suffix: "other", invoiceAmount: 2000, paymentAmount: 500, daysAgo: 120 }
    ] as const;
    for (const fixture of fixtures) {
      const { suffix, invoiceAmount, paymentAmount, daysAgo } = fixture;
      const user = await prisma.user.create({
        data: {
          employeeNo: `${tag}-${suffix}`,
          name: `${tag}-${suffix}`,
          email: `${tag}-${suffix}@example.com`,
          passwordHash: "not-valid",
          isSystem: true,
          role: { connect: { code: "SALES" } }
        },
        select: { id: true }
      });
      createdUserIds.push(user.id);
      if (suffix === "self") salesId = user.id;
      else otherId = user.id;

      const customer = await prisma.customer.create({
        data: {
          code: `${tag}-CUSTOMER-${suffix}`,
          name: `${tag}-客户-${suffix}`,
          customerType: "ENTERPRISE",
          province: "浙江省",
          city: "杭州市",
          contactPhone: "13800000000",
          ownerUserId: user.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      createdCustomerIds.push(customer.id);
      const signDate = new Date(Date.now() - 200 * 86400_000);
      const contract = await prisma.contract.create({
        data: {
          contractNo: `${tag}-CONTRACT-${suffix}`,
          customerId: customer.id,
          customerName: customer.name,
          title: `${tag}-合同-${suffix}`,
          serviceType: "OTHER",
          signDate,
          startDate: signDate,
          endDate: new Date(Date.now() + 365 * 86400_000),
          totalAmount: invoiceAmount,
          taxRate: 0.06,
          taxAmount: 0,
          amountExcludingTax: invoiceAmount,
          paymentMethod: "LUMP_SUM",
          installmentPlan: [],
          status: "ACTIVE",
          ownerUserId: user.id,
          signerId: user.id,
          attachments: [],
          createdById: user.id,
          updatedById: user.id
        }
      });
      createdContractIds.push(contract.id);
      const issuedAt = new Date(Date.now() - daysAgo * 86400_000);
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNo: `${tag}-INVOICE-${suffix}`,
          contractId: contract.id,
          customerId: customer.id,
          customerName: customer.name,
          invoiceType: "VAT_SPECIAL",
          amount: invoiceAmount,
          taxRate: 0.06,
          taxAmount: 0,
          amountExcludingTax: invoiceAmount,
          applyDate: issuedAt,
          actualIssueDate: issuedAt,
          dueDate: issuedAt,
          titleType: "COMPANY",
          titleName: customer.name,
          status: "ISSUED",
          applicantUserId: user.id,
          financeUserId: user.id,
          attachments: [],
          createdById: user.id,
          updatedById: user.id
        }
      });
      createdInvoiceIds.push(invoice.id);
      if (suffix === "self") selfInvoiceId = invoice.id;
      else otherInvoiceId = invoice.id;

      const payment = await prisma.payment.create({
        data: {
          paymentNo: `${tag}-PAYMENT-${suffix}`,
          customerId: customer.id,
          contractId: contract.id,
          invoiceId: invoice.id,
          amount: paymentAmount,
          receivedAt: new Date(),
          method: "BANK_TRANSFER",
          bankRefNo: `${tag}-BANK-${suffix}`,
          status: "CONFIRMED",
          recorderUserId: user.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      createdPaymentIds.push(payment.id);
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceDataQualityIssue.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractIds.length > 0) {
      await prisma.riskScoreSnapshot.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    }
    if (createdCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it("受限角色传他人 ownerUserId, 结果仍只含自己的发票", async () => {
    if (!dbReachable || !salesId || !otherId || !selfInvoiceId || !otherInvoiceId) return;
    const sales = mkUser("SALES", salesId);
    // 恶意入参: 指定他人的 ownerUserId —— 修复后应被强制改回 salesId
    const res = await getInvoiceAging(sales, { ownerUserId: otherId, pageSize: 200 });
    const lightweight = await getInvoiceAgingBuckets(sales);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      invoiceId: selfInvoiceId,
      ownerUserId: salesId,
      remaining: 600,
      bucket: "31-60"
    });
    expect(res.rows.some((row) => row.invoiceId === otherInvoiceId)).toBe(false);
    expect(res.buckets).toEqual(expectedBuckets);
    expect(lightweight).toEqual(expectedBuckets);
    expect(lightweight).toEqual(res.buckets);
  });

  it("EXPERT 同样被强制只能看自己", async () => {
    if (!dbReachable || !salesId || !otherId || !selfInvoiceId || !otherInvoiceId) return;
    const expert = mkUser("EXPERT", salesId);
    const res = await getInvoiceAging(expert, { ownerUserId: otherId, pageSize: 200 });
    const lightweight = await getInvoiceAgingBuckets(expert);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      invoiceId: selfInvoiceId,
      ownerUserId: salesId,
      remaining: 600,
      bucket: "31-60"
    });
    expect(res.rows.some((row) => row.invoiceId === otherInvoiceId)).toBe(false);
    expect(res.buckets).toEqual(expectedBuckets);
    expect(lightweight).toEqual(expectedBuckets);
    expect(lightweight).toEqual(res.buckets);
  });
});
