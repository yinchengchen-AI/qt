// 发票编辑按角色 (P1-2 / P1-3): SALES / FINANCE / ADMIN 都能改 DRAFT;
// OPS 无权;非 admin 在非 DRAFT 状态被拒;admin 跨状态编辑允许.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice, updateInvoice, listInvoices, getInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-INV-EDIT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let opsUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "OPS" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let expertUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "EXPERT" } | null = null;
let testCustomerId: string | null = null;

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
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  // seed:dev-users 会 upsert SALES / OPS, 但本地 dev DB 也可能没有
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, isSystem: false },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const opsRow = await prisma.user.findFirst({
    where: { role: { code: "OPS" }, deletedAt: null, isSystem: false },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const financeRow = await prisma.user.findFirst({
    where: { role: { code: "FINANCE" }, deletedAt: null, isSystem: false },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const expertRow = await prisma.user.findFirst({
    where: { role: { code: "EXPERT" }, deletedAt: null, isSystem: false },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  if (salesRow) salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
  if (opsRow) opsUser = { id: opsRow.id, employeeNo: opsRow.employeeNo, name: opsRow.name, email: opsRow.email, roleCode: "OPS" };
  if (financeRow) financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  if (expertRow) expertUser = { id: expertRow.id, employeeNo: expertRow.employeeNo, name: expertRow.name, email: expertRow.email, roleCode: "EXPERT" };
  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: adminUser.id
    }
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !testCustomerId) return;
  if (!salesUser || !opsUser) return; // 角色不全就跳过
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return { id: salesUser.id, employeeNo: salesUser.employeeNo, name: salesUser.name, email: salesUser.email, roleCode: "SALES", permissions: [] };
};
const buildOps = (): SessionUser => {
  if (!opsUser) throw new Error("ops not bootstrapped");
  return { id: opsUser.id, employeeNo: opsUser.employeeNo, name: opsUser.name, email: opsUser.email, roleCode: "OPS", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};
const buildExpert = (): SessionUser => {
  if (!expertUser) throw new Error("expert not bootstrapped");
  return { id: expertUser.id, employeeNo: expertUser.employeeNo, name: expertUser.name, email: expertUser.email, roleCode: "EXPERT", permissions: [] };
};

// 读放开/写守门用例需要 5 角色中 SALES + FINANCE + EXPERT 都在 (seed:dev-users)
const guardAll = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !testCustomerId) return;
  if (!salesUser || !financeUser || !expertUser) return;
  await fn();
};

async function mkContract(totalAmount: string, suffix: string, ownerUserId?: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const no = `${TAG}-${suffix}`;
  createdContractNos.push(no);
  return prisma.contract.create({
    data: {
      contractNo: no,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount,
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: ownerUserId ?? adminUser!.id,
      signerId: ownerUserId ?? adminUser!.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

async function mkDraft(contractId: string, suffix: string, amount = 100) {
  const inv = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91330000123456789X",
    attachments: []
  });
  if (!inv) throw new Error("createInvoice returned null");
  createdInvoiceIds.push(inv.id);
  return inv;
}

describe("SALES 编辑 DRAFT 发票 (P1-2)", () => {
  it("SALES 改 amount + titleName 写入成功", guard(async () => {
    const c = await mkContract("10000.00", "SALES-OK", salesUser!.id);
    const inv = await mkDraft(c.id, "SALES-OK", 100);
    const updated = await updateInvoice(buildSales(), inv.id, {
      amount: 200,
      titleName: "SALES 改后的抬头"
    });
    expect(updated.amount.toString()).toBe("200");
    expect(updated.titleName).toBe("SALES 改后的抬头");
    expect(updated.status).toBe("DRAFT");
  }));
});

describe("OPS 无权编辑发票 (P1-2)", () => {
  it("OPS 调用 updateInvoice → FORBIDDEN", guard(async () => {
    const c = await mkContract("10000.00", "OPS-FORBIDDEN");
    const inv = await mkDraft(c.id, "OPS-FORBIDDEN", 100);
    await expect(
      updateInvoice(buildOps(), inv.id, { titleName: "试图改" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));
});

describe("非 admin 撞非 DRAFT (P1-3 客户侧)", () => {
  it("SALES 改 PENDING_FINANCE 发票 → ENTITY_IMMUTABLE", guard(async () => {
    const c = await mkContract("10000.00", "SALES-LOCKED", salesUser!.id);
    const inv = await mkDraft(c.id, "SALES-LOCKED", 100);
    // 手动推到 PENDING_FINANCE
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PENDING_FINANCE" } });
    await expect(
      updateInvoice(buildSales(), inv.id, { titleName: "改不动" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE });
  }));
});

describe("ADMIN 跨状态编辑 (P1-3 admin 侧)", () => {
  it("ADMIN 改 PENDING_FINANCE 发票写入成功", guard(async () => {
    const c = await mkContract("10000.00", "ADMIN-CROSS");
    const inv = await mkDraft(c.id, "ADMIN-CROSS", 100);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PENDING_FINANCE" } });
    const updated = await updateInvoice(buildAdmin(), inv.id, {
      titleName: "ADMIN 跨状态改的抬头"
    });
    expect(updated.titleName).toBe("ADMIN 跨状态改的抬头");
    // status 不应该被 PATCH 改回去
    expect(updated.status).toBe("PENDING_FINANCE");
  }));
});

// role-browse-permissions todo 5: 读放开 (SALES/EXPERT 全量可读) + 写守门 (create/update/submit 按合同 owner 403)
describe("发票读放开: SALES 可见他人发票", () => {
  it("SALES get 他人(ADMIN 名下)发票 → 200 返回记录", guardAll(async () => {
    const c = await mkContract("10000.00", "XREAD-GET");
    const inv = await mkDraft(c.id, "XREAD-GET", 100);
    const got = await getInvoice(buildSales(), inv.id);
    expect(got.id).toBe(inv.id);
    expect(got.invoiceNo).toBe(`${TAG}-XREAD-GET`);
  }));

  it("SALES list 命中他人发票 (导出走同一 listInvoices, 随 list 放开)", guardAll(async () => {
    const c = await mkContract("10000.00", "XREAD-LIST");
    const inv = await mkDraft(c.id, "XREAD-LIST", 100);
    const { list } = await listInvoices(buildSales(), { page: 1, pageSize: 100, keyword: `${TAG}-XREAD-LIST` });
    expect(list.some((i) => i.id === inv.id)).toBe(true);
  }));
});

describe("发票写守门: SALES 越权写他人 → 403", () => {
  it("SALES 在他人合同下开票 → FORBIDDEN 403 无权操作他人发票", guardAll(async () => {
    const c = await mkContract("10000.00", "XCREATE");
    await expect(
      createInvoice(buildSales(), {
        contractId: c.id,
        invoiceNo: `${TAG}-XCREATE`,
        invoiceType: "VAT_SPECIAL",
        amount: 100,
        taxRate: 0.06,
        applyDate: new Date().toISOString(),
        titleType: "COMPANY",
        titleName: `${TAG}-抬头`,
        taxNo: "91330000123456789X",
        attachments: []
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403, message: "无权操作他人发票" });
  }));

  it("SALES 改他人发票 → FORBIDDEN 403", guardAll(async () => {
    const c = await mkContract("10000.00", "XUPDATE");
    const inv = await mkDraft(c.id, "XUPDATE", 100);
    await expect(
      updateInvoice(buildSales(), inv.id, { titleName: "越权改" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));

  it("SALES 提交他人 DRAFT 发票 → FORBIDDEN 403 且状态仍 DRAFT", guardAll(async () => {
    const c = await mkContract("10000.00", "XSUBMIT");
    const inv = await mkDraft(c.id, "XSUBMIT", 100);
    await expect(
      invoiceAction(buildSales(), inv.id, { action: "submit" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after?.status).toBe("DRAFT");
  }));
});

describe("发票写守门: 自有与矩阵回归", () => {
  it("SALES 提交自己合同下的 DRAFT 发票 → PENDING_FINANCE", guardAll(async () => {
    const c = await mkContract("10000.00", "OWNSUBMIT", salesUser!.id);
    const inv = await mkDraft(c.id, "OWNSUBMIT", 100);
    const res = await invoiceAction(buildSales(), inv.id, { action: "submit" });
    expect(res?.status).toBe("PENDING_FINANCE");
  }));

  it("EXPERT 任何发票写 (create/update/submit) → FORBIDDEN (矩阵层)", guardAll(async () => {
    const c = await mkContract("10000.00", "EXPERT-W", expertUser!.id);
    const inv = await mkDraft(c.id, "EXPERT-W", 100);
    await expect(
      createInvoice(buildExpert(), {
        contractId: c.id,
        invoiceNo: `${TAG}-EXPERT-W2`,
        invoiceType: "VAT_SPECIAL",
        amount: 100,
        taxRate: 0.06,
        applyDate: new Date().toISOString(),
        titleType: "COMPANY",
        titleName: `${TAG}-抬头`,
        taxNo: "91330000123456789X",
        attachments: []
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
    await expect(
      updateInvoice(buildExpert(), inv.id, { titleName: "越权改" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
    await expect(
      invoiceAction(buildExpert(), inv.id, { action: "submit" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));

  it("FINANCE 对他人(SALES 名下)合同的发票 issue → ISSUED (requireFinance 路径不受 owner 守门影响)", guardAll(async () => {
    const c = await mkContract("10000.00", "FINISSUE", salesUser!.id);
    const inv = await mkDraft(c.id, "FINISSUE", 100);
    await invoiceAction(buildAdmin(), inv.id, { action: "submit" });
    const res = await invoiceAction(buildFinance(), inv.id, { action: "issue" });
    expect(res?.status).toBe("ISSUED");
  }));

  it("SALES 提交不存在的发票 id → NOT_FOUND 404 (不是 500)", guardAll(async () => {
    await expect(
      invoiceAction(buildSales(), `nonexistent-${TAG}`, { action: "submit" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND, status: 404 });
  }));
});
