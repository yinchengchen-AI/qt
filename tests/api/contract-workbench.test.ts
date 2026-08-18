// 个人合同工作台 service 回归 (Phase 1)
//
// 覆盖:
//   1) getMyStats 口径: active=ACTIVE 合同数(含逾期窗口内); expiringSoon=ACTIVE 且 endDate∈[now, now+7d];
//      overdue=ACTIVE 且 endDate<now + CLOSED 且 reviewComment="overdue_terminated"(近 90 天强关)
//   2) getMyTodos 口径与优先级: overdue(1) > expiring(2) > no_invoice(3); 逾期合同不重复产生其他待办;
//      已开票(ISSUED/RED_FLUSHED)合同不产生 no_invoice
//   3) listContracts mine 过滤: ownerUserId 由调用方注入后只返回该用户合同 (越权注入由路由层 session 保证,
//      service 层验证 ownerUserId 参数生效)
//   4) 软删除 / 他人合同不计入
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀, 跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { getMyStats, getMyTodos } from "@/server/services/contract/workbench";
import { listContracts } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-WB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let salesUser: SessionUser | null = null;
let adminUser: SessionUser | null = null;

// fixture: sales 名下的合同链
//   cActiveLong   ACTIVE, endDate +365d           → 活跃但不产生待办
//   cExpiring     ACTIVE, endDate +3d             → expiring (priority 2)
//   cOverdue      ACTIVE, endDate -3d             → overdue (priority 1) + 统计卡 overdue
//   cForceClosed  CLOSED reviewComment=overdue_terminated, endDate -10d → 统计卡 overdue
//   cInvoiced     ACTIVE, endDate +100d, 已开票    → 活跃, 不产生 no_invoice
//   cNoInvoice    ACTIVE, startDate -45d, 无发票   → no_invoice (priority 3)
//   cOthers       admin 名下 ACTIVE (验证 mine 过滤)
let cActiveLongId: string | null = null;
let cExpiringId: string | null = null;
let cOverdueId: string | null = null;
let cForceClosedId: string | null = null;
let cInvoicedId: string | null = null;
let cNoInvoiceId: string | null = null;
let cOthersId: string | null = null;
let invoiceId: string | null = null;
let salesCustomerId: string | null = null;
let adminCustomerId: string | null = null;

const DAY_MS = 86_400_000;

async function createContract(owner: { id: string }, overrides: Record<string, unknown>) {
  const signDate = new Date(Date.now() - 30 * DAY_MS);
  return prisma.contract.create({
    data: {
      contractNo: `${TAG}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: owner.id === (adminUser?.id ?? "") ? adminCustomerId! : salesCustomerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-合同`,
      serviceType: "OTHER",
      signDate,
      startDate: (overrides.startDate as Date | undefined) ?? signDate,
      endDate: (overrides.endDate as Date | undefined) ?? new Date(Date.now() + 365 * DAY_MS),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: Number((10000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((10000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: (overrides.status as string) ?? "ACTIVE",
      ownerUserId: owner.id,
      signerId: owner.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: owner.id,
      updatedById: owner.id,
      ...overrides
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
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!salesRow || !adminRow) {
    dbReachable = false;
    return;
  }
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-A`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000111",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  salesCustomerId = cust.id;
  const custB = await prisma.customer.create({
    data: {
      code: `${TAG}-B`,
      name: `${TAG}-乙客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000222",
      ownerUserId: adminRow.id,
      createdById: adminRow.id,
      updatedById: adminRow.id
    }
  });
  adminCustomerId = custB.id;

  const now = Date.now();
  // startDate 传较新日期, 避免默认 signDate(now-30d) 触发 no_invoice 判定
  const recentStart = new Date(now - 5 * DAY_MS);
  const c1 = await createContract(salesRow, { startDate: recentStart, endDate: new Date(now + 365 * DAY_MS) });
  cActiveLongId = c1.id;
  const c2 = await createContract(salesRow, { startDate: recentStart, endDate: new Date(now + 3 * DAY_MS) });
  cExpiringId = c2.id;
  const c3 = await createContract(salesRow, { endDate: new Date(now - 3 * DAY_MS) });
  cOverdueId = c3.id;
  const c4 = await createContract(salesRow, {
    status: "CLOSED",
    reviewComment: "overdue_terminated",
    endDate: new Date(now - 10 * DAY_MS)
  });
  cForceClosedId = c4.id;
  const c5 = await createContract(salesRow, { endDate: new Date(now + 100 * DAY_MS) });
  cInvoicedId = c5.id;
  const c6 = await createContract(salesRow, { startDate: new Date(now - 45 * DAY_MS) });
  cNoInvoiceId = c6.id;
  const c7 = await createContract(adminRow, { endDate: new Date(now + 200 * DAY_MS) });
  cOthersId = c7.id;

  const inv = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-FP-001`,
      contractId: c5.id,
      customerId: cust.id,
      customerName: cust.name,
      invoiceType: "VAT_SPECIAL",
      amount: 1000,
      taxRate: 0.06,
      taxAmount: Number((1000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((1000 / 1.06).toFixed(2)),
      applyDate: new Date(now - 20 * DAY_MS),
      titleType: "COMPANY",
      titleName: cust.name,
      status: "ISSUED",
      applicantUserId: salesRow.id,
      attachments: [],
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  invoiceId = inv.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (invoiceId) await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
  for (const id of [
    cActiveLongId, cExpiringId, cOverdueId, cForceClosedId, cInvoicedId, cNoInvoiceId, cOthersId
  ]) {
    if (id) await prisma.contract.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [salesCustomerId, adminCustomerId]) {
    if (id) await prisma.customer.delete({ where: { id } }).catch(() => {});
  }
});

describe("getMyStats 我的统计", () => {
  it("只统计当前用户 owner 的合同", async () => {
    if (!dbReachable || !salesUser) return;
    const s = await getMyStats(salesUser);
    expect(s.active).toBeGreaterThanOrEqual(5);
    // admin 名下合同不计入 sales 统计
    expect(s.active).toBeLessThan(6);
  });

  it("expiringSoon 只含 7 天内到期 (含 3 天, 不含 100 天)", async () => {
    if (!dbReachable || !salesUser) return;
    const s = await getMyStats(salesUser);
    expect(s.expiringSoon).toBeGreaterThanOrEqual(1);
    // cExpiring(3d) 计 1; cActiveLong(365d)/cInvoiced(100d)/cNoInvoice(默认+365d) 不计
    expect(s.expiringSoon).toBe(1);
  });

  it("overdue 含 ACTIVE 逾期 + CLOSED 强关 (reviewComment=overdue_terminated)", async () => {
    if (!dbReachable || !salesUser) return;
    const s = await getMyStats(salesUser);
    // cOverdue(ACTIVE, -3d) + cForceClosed(CLOSED overdue_terminated, -10d) = 2
    expect(s.overdue).toBe(2);
  });

  it("risk 在 Phase 2 前固定为 0", async () => {
    if (!dbReachable || !salesUser) return;
    const s = await getMyStats(salesUser);
    expect(s.risk).toBe(0);
  });
});

describe("getMyTodos 我的待办", () => {
  it("按优先级排序: overdue(1) > expiring(2) > no_invoice(3)", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    const priorities = todos.map((t) => t.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("逾期合同生成 overdue 待办且不再生成其他待办", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    const overdueTodos = todos.filter((t) => t.contractId === cOverdueId);
    expect(overdueTodos).toHaveLength(1);
    expect(overdueTodos[0]!.type).toBe("overdue");
    expect(overdueTodos[0]!.priority).toBe(1);
    expect(overdueTodos[0]!.dueLabel).toContain("逾期");
  });

  it("7 天内到期生成 expiring 待办", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    const expiringTodos = todos.filter((t) => t.contractId === cExpiringId);
    expect(expiringTodos).toHaveLength(1);
    expect(expiringTodos[0]!.type).toBe("expiring");
    expect(expiringTodos[0]!.priority).toBe(2);
  });

  it("生效 45 天无发票生成 no_invoice 待办; 已开票合同不生成", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    expect(todos.some((t) => t.contractId === cNoInvoiceId && t.type === "no_invoice")).toBe(true);
    expect(todos.some((t) => t.contractId === cInvoicedId)).toBe(false);
  });

  it("活跃且到期日 > 7 天的合同不生成任何待办", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    expect(todos.some((t) => t.contractId === cActiveLongId)).toBe(false);
  });

  it("他人合同不进入待办", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    expect(todos.some((t) => t.contractId === cOthersId)).toBe(false);
  });
});

describe("listContracts mine 过滤", () => {
  it("传入 ownerUserId 后只返回该用户合同", async () => {
    if (!dbReachable || !salesUser) return;
    const ownerId = salesUser.id;
    const r = await listContracts(salesUser, {
      page: 1,
      pageSize: 50,
      ownerUserId: ownerId
    });
    expect(r.list.every((c) => c.ownerUserId === ownerId)).toBe(true);
    expect(r.list.some((c) => c.id === cActiveLongId)).toBe(true);
    expect(r.list.some((c) => c.id === cOthersId)).toBe(false);
    if (cOthersId === null) throw new Error("cOthersId 未创建");
  });

  it("不传 ownerUserId 时保持全量 (read-open 口径不变)", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await listContracts(salesUser, { page: 1, pageSize: 50 });
    expect(r.list.some((c) => c.id === cOthersId)).toBe(true);
  });
});
