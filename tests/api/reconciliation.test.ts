// 银行流水导入 / 自动对账匹配 Service 测试
// 覆盖:
//   1) parseBankTransactionRow 解析各种格式
//   2) importBankTransactions 批量导入 + 去重
//   3) autoMatchTransaction 自动匹配（高置信度/建议/无匹配）
//   4) confirmMatch / manualMatch / unmatch / ignore
//   5) 权限控制（非财务不可操作）

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  parseBankTransactionRow,
  importBankTransactions,
  autoMatchTransaction,
  confirmMatch,
  manualMatch,
  unmatchTransaction,
  ignoreTransaction,
  getReconciliationSummary,
  listBankTransactions,
} from "@/server/services/reconciliation";
import { createPayment } from "@/server/services/payment";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-RECON-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTxIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
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
  const financeRow = await prisma.user.findFirst({
    where: { role: { code: "FINANCE" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow || !financeRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  if (salesRow) {
    salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
  }
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
    if (createdTxIds.length > 0) {
      await prisma.bankTransaction.deleteMany({ where: { id: { in: createdTxIds } } });
    }
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      // 先删 Payment 再删合同, 避免外键约束
      await prisma.payment.deleteMany({ where: { contract: { contractNo: { in: createdContractNos } } } });
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
    await prisma.reconciliationDiscrepancy.deleteMany({ where: { description: { contains: TAG } } });
    await prisma.message.deleteMany({ where: { entityKey: { contains: TAG } } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !financeUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return { id: salesUser.id, employeeNo: salesUser.employeeNo, name: salesUser.name, email: salesUser.email, roleCode: "SALES", permissions: [] };
};

async function mkContract(totalAmount: string, suffix: string) {
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
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

function digits20(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return u.toString().padStart(10, "0").padEnd(20, "0").slice(-20);
}

async function mkIssuedInvoice(contractId: string, amount: number, suffix: string) {
  const inv = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
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
  await invoiceAction(buildFinance(), inv.id, { action: "submit" });
  await invoiceAction(buildFinance(), inv.id, { action: "issue", invoiceNo: digits20(`${TAG}-INV-${suffix}`) });
  return inv;
}

async function mkPayment(contractId: string, invoiceId: string | undefined, amount: number, _suffix: string) {
  const p = await createPayment(buildAdmin(), {
    contractId,
    invoiceId,
    amount,
    receivedAt: new Date().toISOString(),
    method: "BANK_TRANSFER",
  });
  if (!p) throw new Error("createPayment returned null");
  createdPaymentIds.push(p.id);
  return p;
}

// =====================================================
// 1. parseBankTransactionRow 解析测试
// =====================================================

describe("parseBankTransactionRow", () => {
  it("解析标准中文字段", () => {
    const row = {
      "流水号": "20260820001",
      "交易日期": "2026-08-20",
      "金额": "50,000.00",
      "对方户名": "杭州某某科技有限公司",
      "摘要": "合同款",
    };
    const result = parseBankTransactionRow(row, 2);
    expect(result.bankRefNo).toBe("20260820001");
    expect(result.amount).toBe(50000);
    expect(result.counterpartyName).toBe("杭州某某科技有限公司");
  });

  it("解析英数字段", () => {
    const row = {
      refNo: "20260820002",
      transactionDate: "2026-08-20",
      amount: "30000.50",
      counterpartyName: "Test Corp",
    };
    const result = parseBankTransactionRow(row, 2);
    expect(result.bankRefNo).toBe("20260820002");
    expect(result.amount).toBe(30000.5);
  });

  it("YYYYMMDD 日期格式", () => {
    const row = {
      "流水号": "20260820003",
      "交易日期": "20260820",
      "金额": "10000",
    };
    const result = parseBankTransactionRow(row, 2);
    expect(result.transactionDate.getFullYear()).toBe(2026);
    expect(result.transactionDate.getMonth()).toBe(7); // 0-based
    expect(result.transactionDate.getDate()).toBe(20);
  });

  it("缺少必填字段抛错", () => {
    expect(() => parseBankTransactionRow({ "金额": "100" }, 2)).toThrow("流水号不能为空");
    expect(() => parseBankTransactionRow({ "流水号": "001" }, 2)).toThrow("交易日期不能为空");
    expect(() => parseBankTransactionRow({ "流水号": "001", "交易日期": "2026-08-20" }, 2)).toThrow("金额不能为空");
  });

  it("无效金额抛错", () => {
    expect(() =>
      parseBankTransactionRow({ "流水号": "001", "交易日期": "2026-08-20", "金额": "abc" }, 2)
    ).toThrow("金额格式无效");
  });

  it("金额为负数取绝对值", () => {
    const result = parseBankTransactionRow(
      { "流水号": "001", "交易日期": "2026-08-20", "金额": "-5000" },
      2
    );
    expect(result.amount).toBe(5000);
  });
});

// =====================================================
// 2. importBankTransactions 导入测试
// =====================================================

describe("importBankTransactions", () => {
  it("批量导入成功", guard(async () => {
    const rows = [
      { "流水号": `${TAG}-001`, "交易日期": "2026-08-20", "金额": "10000", "对方户名": `${TAG}-客户` },
      { "流水号": `${TAG}-002`, "交易日期": "2026-08-20", "金额": "20000", "对方户名": `${TAG}-客户` },
    ];
    const result = await importBankTransactions(buildFinance(), rows);
    expect(result.total).toBe(2);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
  }));

  it("同批次去重", guard(async () => {
    const rows = [
      { "流水号": `${TAG}-DUP-001`, "交易日期": "2026-08-20", "金额": "10000" },
      { "流水号": `${TAG}-DUP-001`, "交易日期": "2026-08-20", "金额": "10000" },
    ];
    const result = await importBankTransactions(buildFinance(), rows);
    expect(result.total).toBe(2);
    expect(result.success).toBe(1); // 只有一条成功
  }));

  it("跨批次重复流水静默跳过", guard(async () => {
    const row = { "流水号": `${TAG}-EXIST-001`, "交易日期": "2026-08-20", "金额": "5000" };
    await importBankTransactions(buildFinance(), [row]);
    const result = await importBankTransactions(buildFinance(), [row]);
    expect(result.success).toBe(0); // 已存在，跳过
  }));

  it("非财务角色拒绝导入", guard(async () => {
    const rows = [{ "流水号": "X", "交易日期": "2026-08-20", "金额": "100" }];
    // SALES 无 RECONCILIATION CREATE 权限, requirePermission 先抛 403
    await expect(importBankTransactions(buildSales(), rows)).rejects.toThrow("无权 CREATE RECONCILIATION");
  }));
});

// =====================================================
// 3. autoMatchTransaction 匹配测试
// =====================================================

describe("autoMatchTransaction", () => {
  it("高置信度自动匹配（金额+日期+客户名精确）", guard(async () => {
    const contract = await mkContract("100000", "AUTO-MATCH");
    const inv = await mkIssuedInvoice(contract.id, 50000, "AUTO-MATCH");
    const payment = await mkPayment(contract.id, inv.id, 50000, "AUTO-MATCH");

    // 先清理同金额的其他 payment, 避免第二名拉不开分差
    await prisma.payment.deleteMany({
      where: {
        amount: 50000,
        id: { not: payment.id },
        deletedAt: null,
      },
    });

    // 用发票号作为摘要关键词, 把分数推到 ≥80
    // 金额 40 + 日期 20 + 客户名 25 + 发票号 15 = 100
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-AUTO-001`,
        transactionDate: new Date(),
        amount: 50000,
        counterpartyName: `${TAG}-客户`,
        summary: `发票号 ${inv.invoiceNo}`,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await autoMatchTransaction(buildFinance(), tx.id);
    expect(result.action).toBe("AUTO_MATCHED");
    expect(result.transaction.matchStatus).toBe("AUTO_MATCHED");
    expect(result.transaction.paymentId).toBe(payment.id);
    expect(result.transaction.matchScore?.greaterThanOrEqualTo(80)).toBe(true);
  }));

  it("无候选时返回 NO_MATCH", guard(async () => {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-NOMATCH-001`,
        transactionDate: new Date("2020-01-01"),
        amount: 999999,
        counterpartyName: "不存在的公司",
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await autoMatchTransaction(buildFinance(), tx.id);
    expect(result.action).toBe("NO_MATCH");
  }));

  it("已处理流水拒绝重复匹配", guard(async () => {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-PROCESSED-001`,
        transactionDate: new Date(),
        amount: 10000,
        matchStatus: "CONFIRMED_MATCHED",
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    await expect(autoMatchTransaction(buildFinance(), tx.id)).rejects.toThrow("该流水已被处理");
  }));
});

// =====================================================
// 4. 匹配操作测试
// =====================================================

describe("match operations", () => {
  it("confirmMatch 确认匹配并更新 Payment", guard(async () => {
    const contract = await mkContract("100000", "CONFIRM");
    const inv = await mkIssuedInvoice(contract.id, 30000, "CONFIRM");
    const payment = await mkPayment(contract.id, inv.id, 30000, "CONFIRM");

    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-CONFIRM-001`,
        transactionDate: new Date(),
        amount: 30000,
        matchStatus: "AUTO_MATCHED",
        paymentId: payment.id,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await confirmMatch(buildFinance(), tx.id, payment.id);
    expect(result.matchStatus).toBe("CONFIRMED_MATCHED");
    expect(result.matchedById).toBe(financeUser!.id);

    // Payment 应更新 bankRefNo
    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment?.bankRefNo).toBe(`${TAG}-CONFIRM-001`);
  }));

  it("manualMatch 手动匹配", guard(async () => {
    const contract = await mkContract("100000", "MANUAL");
    const inv = await mkIssuedInvoice(contract.id, 20000, "MANUAL");
    const payment = await mkPayment(contract.id, inv.id, 20000, "MANUAL");

    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-MANUAL-001`,
        transactionDate: new Date(),
        amount: 20000,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await manualMatch(buildFinance(), tx.id, payment.id);
    expect(result.matchStatus).toBe("MANUAL_MATCHED");
  }));

  it("unmatch 取消匹配", guard(async () => {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-UNMATCH-001`,
        transactionDate: new Date(),
        amount: 10000,
        matchStatus: "AUTO_MATCHED",
        paymentId: "dummy",
        matchScore: 85,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await unmatchTransaction(buildFinance(), tx.id);
    expect(result.matchStatus).toBe("UNMATCHED");
    expect(result.paymentId).toBeNull();
    expect(result.matchScore).toBeNull();
  }));

  it("ignore 忽略流水", guard(async () => {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-IGNORE-001`,
        transactionDate: new Date(),
        amount: 5000,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const result = await ignoreTransaction(buildFinance(), tx.id);
    expect(result.matchStatus).toBe("IGNORED");
  }));
});

// =====================================================
// 5. 查询服务测试
// =====================================================

describe("query services", () => {
  it("getReconciliationSummary 返回统计", guard(async () => {
    const summary = await getReconciliationSummary(buildFinance());
    expect(summary).toHaveProperty("unmatchedCount");
    expect(summary).toHaveProperty("suggestedCount");
    expect(summary).toHaveProperty("autoMatchedCount");
    expect(summary).toHaveProperty("confirmedCount");
    expect(summary).toHaveProperty("ignoredCount");
    expect(summary).toHaveProperty("discrepancyCount");
  }));

  it("listBankTransactions 分页查询", guard(async () => {
    const result = await listBankTransactions(buildFinance(), { page: 1, pageSize: 10 });
    expect(result.list).toBeDefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  }));

  it("listBankTransactions 按状态筛选", guard(async () => {
    const result = await listBankTransactions(buildFinance(), {
      page: 1,
      pageSize: 10,
      matchStatus: "UNMATCHED",
    });
    for (const tx of result.list) {
      expect(tx.matchStatus).toBe("UNMATCHED");
    }
  }));
});
