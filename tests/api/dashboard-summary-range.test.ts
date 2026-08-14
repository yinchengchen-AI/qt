// dashboard/summary 路由回归 — 区间过滤 + 待审计数
//
// 覆盖:
//   1) range=month 时 topCustomers 只含当月签订合同的客户
//      (回归: route 曾漏传 range,Top 5 客户无视月/季/年,显示全期数据)
//   2) from/to 全期范围时 topCustomers 含去年签订的客户(对照组)
//   3) invoices.pending 独立计数待财务审核发票,不受 actualIssueDate 区间过滤影响
//      (回归: byStatus 按 actualIssueDate 过滤会排除 actualIssueDate=null 的
//        PENDING_FINANCE,导致"待审/待开票"恒为 0)
//
// DB 不可达时整组 skip。数据用 unique TAG 前缀,跑完自己清理。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { GET as getDashboardSummary } from "@/app/api/dashboard/summary/route";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

// 路由测试用: mock requireSession 返回当前 actor (per-case 注入)
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      return sessionHolder.actor;
    }
  };
});

let dbReachable = false;
const TAG = `TEST-DASH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
const customerIds: string[] = [];
const contractNos: string[] = [];
const invoiceIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return adminUser;
};

async function makeContract(suffix: string, customerId: string, name: string, amount: number, signDate: Date) {
  const ctr = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-CTR-${suffix}`,
      customerId,
      customerName: name,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate,
      startDate: signDate,
      endDate: new Date(signDate.getTime() + 365 * 86400_000),
      totalAmount: amount,
      taxRate: 0.06,
      taxAmount: Number((amount * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((amount / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      installmentPlan: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["installmentPlan"],
      status: "ACTIVE",
      ownerUserId: adminUser!.id,
      signerId: adminUser!.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser!.id,
      updatedById: adminUser!.id
    }
  });
  contractNos.push(ctr.contractNo);
  return ctr;
}

async function makeCustomer(code: string, name: string) {
  const cust = await prisma.customer.create({
    data: {
      code,
      name,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      createdById: adminUser!.id,
      updatedById: adminUser!.id,
      ownerUserId: adminUser!.id
    }
  });
  customerIds.push(cust.id);
  return cust;
}

const callSummary = (qs: string) => {
  sessionHolder.actor = buildAdmin();
  return getDashboardSummary(new Request(`http://localhost/api/dashboard/summary?${qs}`)).then((r) => r.json());
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };

  const custMonth = await makeCustomer(`${TAG}-CUST-M`, `${TAG}-本月客户`);
  await makeContract("month", custMonth.id, custMonth.name, 99_999_000, new Date());
  const custLastYear = await makeCustomer(`${TAG}-CUST-L`, `${TAG}-去年客户`);
  await makeContract("last-year", custLastYear.id, custLastYear.name, 88_888_000, new Date(Date.now() - 400 * 86400_000));

  // 一张待财务审核发票(PENDING_FINANCE, actualIssueDate=null)
  const inv = await createInvoice(buildAdmin(), {
    contractId: (await prisma.contract.findFirst({ where: { contractNo: `${TAG}-CTR-month` } }))!.id,
    invoiceNo: `${TAG}-INV-1`,
    invoiceType: "VAT_SPECIAL",
    amount: 1000,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91110000123456789X",
    attachments: []
  });
  if (inv) {
    await invoiceAction(buildAdmin(), inv.id, { action: "submit" });
    invoiceIds.push(inv.id);
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (invoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (contractNos.length > 0) {
      const ctrIds = (await prisma.contract.findMany({ where: { contractNo: { in: contractNos } }, select: { id: true } })).map((c) => c.id);
      if (ctrIds.length > 0) {
        await prisma.payment.deleteMany({ where: { contractId: { in: ctrIds } } });
      }
      await prisma.contract.deleteMany({ where: { contractNo: { in: contractNos } } });
    }
    if (customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
  } catch {
    // ignore cleanup errors
  }
  await prisma.$disconnect();
});

const itDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !adminUser) return;
    await fn();
  });

describe("dashboard/summary 区间过滤", () => {
  itDb("range=month: Top 5 只含当月签订合同的客户,不含去年客户", async () => {
    const j = await callSummary("range=month");
    expect(j.code).toBe(0);
    const names = j.data.topCustomers.map((c: { name: string }) => c.name);
    expect(names).toContain(`${TAG}-本月客户`);
    expect(names).not.toContain(`${TAG}-去年客户`);
  });

  itDb("from/to 全期: Top 5 同时含本月与去年客户(对照组)", async () => {
    const from = new Date(Date.now() - 401 * 86400_000).toISOString();
    const to = new Date().toISOString();
    const j = await callSummary(`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(j.code).toBe(0);
    const names = j.data.topCustomers.map((c: { name: string }) => c.name);
    expect(names).toContain(`${TAG}-本月客户`);
    expect(names).toContain(`${TAG}-去年客户`);
  });
});

describe("dashboard/summary 待审计数", () => {
  itDb("invoices.pending 独立计数 PENDING_FINANCE,不受 actualIssueDate 区间过滤影响", async () => {
    const j = await callSummary("range=month");
    expect(j.code).toBe(0);
    // 至少含本测试造的 1 张待审发票(其它并行用例可能还造了更多)
    expect(j.data.invoices.pending).toBeGreaterThanOrEqual(1);
    // byStatus 是区间内已开票口径,不含 PENDING_FINANCE
    expect(j.data.invoices.byStatus.every((s: { status: string }) => s.status !== "PENDING_FINANCE")).toBe(true);
  });
});
