// 智能催款建议 service 集成测试 (DB 可达才跑, 跑完自清理)
//   1) 逾期发票进入建议清单, 紧急度/话术/invoiceId 正确
//   2) 按合同聚合: 同一合同多张逾期发票金额求和, 逾期天数取最大
//   3) SALES 行级隔离: 只看得到自己名下合同的催款建议
//   4) 运行时权限收窄 DUNNING.READ → 403
//   5) 已付清 / 未到期 / 非 ISSUED 的发票不进入清单
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  ACTION,
  RESOURCE,
  ROLE_PERMISSIONS,
  _resetRuntimePermissionsForTests,
  setRuntimePermissions
} from "@/lib/permissions";
import { getCollectionAdvice } from "@/server/services/collection-advice";

let dbReachable = false;
const TAG = `TEST-COLLECT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// sales 名下: 客户A → 合同A (2 张逾期发票) / 合同B (1 张已付清发票, 不应出现)
// admin 名下: 客户B → 合同C (1 张逾期发票, SALES 不应看到)
const createdCustomerIds: string[] = [];
const createdContractIds: string[] = [];
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];

let salesContractAId: string | null = null;
let salesContractANo: string | null = null;
let adminContractCId: string | null = null;

async function makeContract(customerId: string, customerName: string, ownerId: string, suffix: string) {
  return prisma.contract.create({
    data: {
      contractNo: `${TAG}-HT-${suffix}`,
      customerId,
      customerName,
      title: `${TAG}-合同${suffix}`,
      serviceType: "OTHER",
      signDate: daysAgo(200),
      startDate: daysAgo(180),
      endDate: new Date(Date.now() + 180 * DAY_MS),
      totalAmount: 100000,
      taxRate: 0.06,
      taxAmount: 5660.38,
      amountExcludingTax: 94339.62,
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: ownerId,
      signerId: ownerId,
      attachments: [],
      createdById: ownerId,
      updatedById: ownerId
    }
  });
}

async function makeInvoice(
  contractId: string,
  customerId: string,
  customerName: string,
  ownerId: string,
  suffix: string,
  opts: { amount: number; dueDaysAgo: number | null; status?: string }
) {
  return prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-FP-${suffix}`,
      contractId,
      customerId,
      customerName,
      invoiceType: "VAT_SPECIAL",
      amount: opts.amount,
      taxRate: 0.06,
      taxAmount: Number((opts.amount * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((opts.amount / 1.06).toFixed(2)),
      applyDate: daysAgo((opts.dueDaysAgo ?? 0) + 30),
      actualIssueDate: daysAgo((opts.dueDaysAgo ?? 0) + 25),
      dueDate: opts.dueDaysAgo === null ? null : daysAgo(opts.dueDaysAgo),
      titleType: "COMPANY",
      titleName: customerName,
      status: opts.status ?? "ISSUED",
      applicantUserId: ownerId,
      attachments: [],
      createdById: ownerId,
      updatedById: ownerId
    }
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow || !salesRow) {
    dbReachable = false;
    return;
  }
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  const custA = await prisma.customer.create({
    data: {
      code: `${TAG}-A`,
      name: `${TAG}-客户A`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000001",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  createdCustomerIds.push(custA.id);
  const custB = await prisma.customer.create({
    data: {
      code: `${TAG}-B`,
      name: `${TAG}-客户B`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000002",
      ownerUserId: adminRow.id,
      createdById: adminRow.id,
      updatedById: adminRow.id
    }
  });
  createdCustomerIds.push(custB.id);

  // 合同A (sales): 2 张逾期发票 (40 天 ¥60000 + 10 天 ¥30000) → 聚合后 未收 90000, 逾期 40 天
  const contractA = await makeContract(custA.id, custA.name, salesRow.id, "A");
  createdContractIds.push(contractA.id);
  salesContractAId = contractA.id;
  salesContractANo = contractA.contractNo;
  const invA1 = await makeInvoice(contractA.id, custA.id, custA.name, salesRow.id, "A1", { amount: 60000, dueDaysAgo: 40 });
  const invA2 = await makeInvoice(contractA.id, custA.id, custA.name, salesRow.id, "A2", { amount: 30000, dueDaysAgo: 10 });
  createdInvoiceIds.push(invA1.id, invA2.id);

  // 合同B (sales): 发票已全额回款 → 不出现
  const contractB = await makeContract(custA.id, custA.name, salesRow.id, "B");
  createdContractIds.push(contractB.id);
  const invB1 = await makeInvoice(contractB.id, custA.id, custA.name, salesRow.id, "B1", { amount: 20000, dueDaysAgo: 50 });
  createdInvoiceIds.push(invB1.id);
  const payB = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-SK-B1`,
      customerId: custA.id,
      contractId: contractB.id,
      invoiceId: invB1.id,
      amount: 20000,
      receivedAt: daysAgo(20),
      method: "BANK_TRANSFER",
      status: "CONFIRMED",
      recorderUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  createdPaymentIds.push(payB.id);

  // 未到期发票 (dueDate 在未来) → 不出现
  const invB2 = await makeInvoice(contractB.id, custA.id, custA.name, salesRow.id, "B2", { amount: 50000, dueDaysAgo: -30 });
  createdInvoiceIds.push(invB2.id);

  // DRAFT 发票 (未开出) → 不出现
  const invB3 = await makeInvoice(contractB.id, custA.id, custA.name, salesRow.id, "B3", { amount: 80000, dueDaysAgo: 90, status: "DRAFT" });
  createdInvoiceIds.push(invB3.id);

  // 合同C (admin): 1 张逾期发票 → SALES 不可见
  const contractC = await makeContract(custB.id, custB.name, adminRow.id, "C");
  createdContractIds.push(contractC.id);
  adminContractCId = contractC.id;
  const invC1 = await makeInvoice(contractC.id, custB.id, custB.name, adminRow.id, "C1", { amount: 88000, dueDaysAgo: 65 });
  createdInvoiceIds.push(invC1.id);
});

afterAll(async () => {
  if (!dbReachable) return;
  for (const id of createdPaymentIds) await prisma.payment.delete({ where: { id } }).catch(() => {});
  for (const id of createdInvoiceIds) await prisma.invoice.delete({ where: { id } }).catch(() => {});
  for (const id of createdContractIds) await prisma.contract.delete({ where: { id } }).catch(() => {});
  for (const id of createdCustomerIds) await prisma.customer.delete({ where: { id } }).catch(() => {});
});

describe("getCollectionAdvice 智能催款建议", () => {
  it("逾期合同进入清单, 金额聚合 + 紧急度 + 话术 + invoiceId 正确", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await getCollectionAdvice(adminUser);
    const item = r.items.find((i) => i.contractId === salesContractAId);
    expect(item).toBeDefined();
    // 2 张逾期发票聚合: 60000 + 30000
    expect(item!.outstandingAmount).toBeCloseTo(90000, 2);
    expect(item!.overdueDays).toBeGreaterThanOrEqual(40);
    // 40 天(30 分) + 金额 9 万(20 分) = 50 → HIGH; 客户A有按时付款记录(合同B)不触发低信用
    expect(["HIGH", "CRITICAL"]).toContain(item!.urgencyLevel);
    expect(item!.talkTracks.length).toBeGreaterThan(0);
    // 话术携带合同号与金额
    expect(item!.talkTracks.join(" ")).toContain(salesContractANo);
    // invoiceId 指向最逾期那张 (A1)
    const invA1 = createdInvoiceIds[0];
    expect(item!.invoiceId).toBe(invA1);
    expect(item!.suggestedApproach.length).toBeGreaterThan(0);
    expect(r.totalOverdueContracts).toBeGreaterThanOrEqual(2); // A + C
  });

  it("已付清 / 未到期 / DRAFT 发票不进入清单", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await getCollectionAdvice(adminUser);
    const contractBIds = r.items.filter((i) => i.contractNo === `${TAG}-HT-B`);
    expect(contractBIds).toHaveLength(0);
  });

  it("SALES 行级隔离: 只看得到自己名下合同的催款建议", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await getCollectionAdvice(salesUser);
    expect(r.items.some((i) => i.contractId === salesContractAId)).toBe(true);
    expect(r.items.some((i) => i.contractId === adminContractCId)).toBe(false);
  });

  it("DUNNING.READ 被收窄后抛 403", async () => {
    if (!dbReachable || !salesUser) return;
    const narrowed = ROLE_PERMISSIONS.SALES.map((p) =>
      p.resource === RESOURCE.DUNNING
        ? { ...p, actions: p.actions.filter((a) => a !== ACTION.READ) }
        : p
    );
    try {
      setRuntimePermissions("SALES", narrowed);
      await expect(getCollectionAdvice(salesUser)).rejects.toThrow();
    } finally {
      _resetRuntimePermissionsForTests();
    }
  });
});
