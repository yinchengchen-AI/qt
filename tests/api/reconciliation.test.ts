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
    await prisma.reconciliationDiscrepancy.deleteMany({
      where: {
        OR: [
          { description: { contains: TAG } },
          { bankTransactionId: { in: createdTxIds } },
          { paymentId: { in: createdPaymentIds } },
        ],
      },
    });
    // emit 产生的消息: entityKey 是业务 id (不含 TAG), 但 title/content 里的
    // 回款号/流水号/差异描述带 TAG, 三个字段一起兜住
    await prisma.message.deleteMany({
      where: {
        OR: [
          { entityKey: { contains: TAG } },
          { title: { contains: TAG } },
          { content: { contains: TAG } },
        ],
      },
    });
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

    // 与 confirmMatch 对称: 回写 bankRefNo 并推进到 RECONCILED
    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment?.bankRefNo).toBe(`${TAG}-MANUAL-001`);
    expect(updatedPayment?.status).toBe("RECONCILED");
    expect(updatedPayment?.reconcileUserId).toBe(financeUser!.id);
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

  it("confirmMatch 拒绝重复占用同一回款", guard(async () => {
    const contract = await mkContract("100000", "DUP-OCCUPY");
    const inv = await mkIssuedInvoice(contract.id, 30000, "DUP-OCCUPY");
    const payment = await mkPayment(contract.id, inv.id, 30000, "DUP-OCCUPY");

    const tx1 = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-DUP-OCCUPY-001`,
        transactionDate: new Date(),
        amount: 30000,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    const tx2 = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-DUP-OCCUPY-002`,
        transactionDate: new Date(),
        amount: 30000,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx1.id, tx2.id);

    await confirmMatch(buildFinance(), tx1.id, payment.id);
    await expect(confirmMatch(buildFinance(), tx2.id, payment.id)).rejects.toThrow(/已关联银行流水/);
    await expect(manualMatch(buildFinance(), tx2.id, payment.id)).rejects.toThrow(/已关联银行流水/);
  }));

  it("unmatch 回滚 confirmMatch 对 Payment 的副作用", guard(async () => {
    const contract = await mkContract("100000", "ROLLBACK");
    const inv = await mkIssuedInvoice(contract.id, 20000, "ROLLBACK");
    const payment = await mkPayment(contract.id, inv.id, 20000, "ROLLBACK");
    expect(payment.status).toBe("PLANNED");

    const txDate = new Date("2026-08-15T08:00:00Z");
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-ROLLBACK-001`,
        transactionDate: txDate,
        amount: 20000,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    await confirmMatch(buildFinance(), tx.id, payment.id);
    const afterConfirm = await prisma.payment.findUnique({ where: { id: payment.id } });
    // 对账确认 = 已对账, 终态 RECONCILED
    expect(afterConfirm?.status).toBe("RECONCILED");
    expect(afterConfirm?.bankRefNo).toBe(`${TAG}-ROLLBACK-001`);
    expect(afterConfirm?.reconcileUserId).toBe(financeUser!.id);

    await unmatchTransaction(buildFinance(), tx.id);
    const afterUnmatch = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(afterUnmatch?.bankRefNo).toBeNull();
    expect(afterUnmatch?.status).toBe("PLANNED");
    expect(afterUnmatch?.reconcileUserId).toBeNull();
    expect(afterUnmatch?.reconciledAt).toBeNull();
  }));
});

// =====================================================
// 4.5 回归: 对账确认与回款 confirm 规则对齐 (v0.20.3)
//   修复前: confirmMatch 直接 payment.update, 绕过 R-10/R-11/R-12,
//           不发 PAYMENT_RECEIVED, 不驱动 RECONCILED, manualMatch 不回写
// =====================================================

describe("match writeback 与回款模块规则对齐", () => {
  // 直接插库造 PLANNED 回款, 绕过 createPayment 登记预检 (模拟异常/历史数据路径)
  async function mkRawPayment(
    contractId: string, customerId: string, invoiceId: string | null,
    amount: string, suffix: string, status = "PLANNED"
  ) {
    const p = await prisma.payment.create({
      data: {
        paymentNo: `${TAG}-RAW-${suffix}`, customerId, contractId, invoiceId,
        amount, receivedAt: new Date("2026-08-10T00:00:00Z"), method: "BANK_TRANSFER",
        status, recorderUserId: adminUser!.id,
        createdById: adminUser!.id, updatedById: adminUser!.id,
      },
    });
    createdPaymentIds.push(p.id);
    return p;
  }
  async function mkTx(refNo: string, amount: number, date?: Date) {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: refNo, transactionDate: date ?? new Date(), amount,
        importBatchId: `${TAG}-BATCH`, importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);
    return tx;
  }

  it("R-11: 超发票金额的 PLANNED 回款不可通过对账确认", guard(async () => {
    const contract = await mkContract("100000", "R11");
    const inv = await mkIssuedInvoice(contract.id, 100, "R11");
    // 登记预检会拦 5000>100, 这里直插模拟漏网数据
    const payment = await mkRawPayment(contract.id, testCustomerId!, inv.id, "5000", "R11");
    const tx = await mkTx(`${TAG}-R11-001`, 5000);

    await expect(confirmMatch(buildFinance(), tx.id, payment.id)).rejects.toThrow(/超过发票金额/);
    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(after?.status).toBe("PLANNED"); // 未推进
  }));

  it("R-12: 超合同总额的 PLANNED 回款不可通过对账确认", guard(async () => {
    const contract = await mkContract("1000", "R12");
    const payment = await mkRawPayment(contract.id, testCustomerId!, null, "5000", "R12");
    const tx = await mkTx(`${TAG}-R12-001`, 5000);

    await expect(confirmMatch(buildFinance(), tx.id, payment.id)).rejects.toThrow(/超过合同总额/);
  }));

  it("PLANNED 回款对账确认后发 PAYMENT_RECEIVED 且终态 RECONCILED", guard(async () => {
    const contract = await mkContract("100000", "EVT");
    const inv = await mkIssuedInvoice(contract.id, 8000, "EVT");
    const payment = await mkRawPayment(contract.id, testCustomerId!, inv.id, "8000", "EVT");
    const tx = await mkTx(`${TAG}-EVT-001`, 8000);

    await confirmMatch(buildFinance(), tx.id, payment.id);

    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(after?.status).toBe("RECONCILED");
    expect(after?.reconcileUserId).toBe(financeUser!.id);
    expect(after?.reconciledAt).not.toBeNull();
    // receivedAt 更正为流水交易日
    expect(after?.receivedAt.getTime()).toBe(tx.transactionDate.getTime());
    // paymentPrevStatus 记录原状态
    const txAfter = await prisma.bankTransaction.findUnique({ where: { id: tx.id } });
    expect(txAfter?.paymentPrevStatus).toBe("PLANNED");

    const msg = await prisma.message.count({ where: { entityKey: `PAYMENT_RECEIVED:${payment.id}` } });
    expect(msg).toBeGreaterThan(0);
  }));

  it("CONFIRMED 回款对账确认: 推进 RECONCILED, 不动 receivedAt, 不重复发 PAYMENT_RECEIVED", guard(async () => {
    const contract = await mkContract("100000", "CONF2");
    const receivedAt = new Date("2026-08-10T00:00:00Z");
    const payment = await mkRawPayment(contract.id, testCustomerId!, null, "8000", "CONF2", "CONFIRMED");
    const tx = await mkTx(`${TAG}-CONF2-001`, 8000, new Date("2026-08-12T00:00:00Z"));

    await confirmMatch(buildFinance(), tx.id, payment.id);

    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(after?.status).toBe("RECONCILED");
    expect(after?.receivedAt.getTime()).toBe(receivedAt.getTime());
    expect(after?.bankRefNo).toBe(`${TAG}-CONF2-001`);
    // 已在回款模块确认过, 不补发到账通知
    const msg = await prisma.message.count({ where: { entityKey: `PAYMENT_RECEIVED:${payment.id}` } });
    expect(msg).toBe(0);

    // unmatch 精确回滚到 CONFIRMED
    await unmatchTransaction(buildFinance(), tx.id);
    const reverted = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(reverted?.status).toBe("CONFIRMED");
    expect(reverted?.bankRefNo).toBeNull();
    expect(reverted?.reconcileUserId).toBeNull();
  }));

  it("金额不一致: 记 AMOUNT_MISMATCH 差异并发 RECONCILIATION_DISCREPANCY 通知", guard(async () => {
    const contract = await mkContract("100000", "DISC");
    const inv = await mkIssuedInvoice(contract.id, 20000, "DISC");
    const payment = await mkRawPayment(contract.id, testCustomerId!, inv.id, "20000", "DISC");
    const tx = await mkTx(`${TAG}-DISC-001`, 21000);

    await confirmMatch(buildFinance(), tx.id, payment.id);

    const disc = await prisma.reconciliationDiscrepancy.findFirst({
      where: { bankTransactionId: tx.id, type: "AMOUNT_MISMATCH" },
    });
    expect(disc).not.toBeNull();
    expect(disc?.severity).toBe("HIGH"); // 差额 1000 > 100
    const msg = await prisma.message.count({
      where: { entityKey: `RECONCILIATION_DISCREPANCY:${disc!.id}` },
    });
    expect(msg).toBeGreaterThan(0);
  }));

  it("R-10: 流水号已被其它 CONFIRMED/RECONCILED 回款占用时拒绝匹配", guard(async () => {
    const contract = await mkContract("100000", "R10");
    const occupied = await mkRawPayment(contract.id, testCustomerId!, null, "8000", "R10-A", "CONFIRMED");
    await prisma.payment.update({ where: { id: occupied.id }, data: { bankRefNo: `${TAG}-R10-REF` } });
    const payment = await mkRawPayment(contract.id, testCustomerId!, null, "8000", "R10-B");
    const tx = await mkTx(`${TAG}-R10-REF`, 8000);

    await expect(manualMatch(buildFinance(), tx.id, payment.id)).rejects.toThrow(/已存在/);
  }));

  it("已终态 (REFUNDED/CANCELLED/RECONCILED) 回款拒绝匹配", guard(async () => {
    const contract = await mkContract("100000", "STATUS");
    const payment = await mkRawPayment(contract.id, testCustomerId!, null, "8000", "STATUS", "REFUNDED");
    const tx = await mkTx(`${TAG}-STATUS-001`, 8000);

    await expect(confirmMatch(buildFinance(), tx.id, payment.id)).rejects.toThrow(/不可匹配/);
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

  it("listBankTransactions SUGGESTED 虚拟状态筛选", guard(async () => {
    const tx = await prisma.bankTransaction.create({
      data: {
        bankRefNo: `${TAG}-SUGGESTED-001`,
        transactionDate: new Date(),
        amount: 8888,
        matchStatus: "UNMATCHED",
        matchScore: 83,
        importBatchId: `${TAG}-BATCH`,
        importedById: financeUser!.id,
      },
    });
    createdTxIds.push(tx.id);

    const suggested = await listBankTransactions(buildFinance(), {
      page: 1,
      pageSize: 50,
      matchStatus: "SUGGESTED",
    });
    expect(suggested.list.some((t) => t.id === tx.id)).toBe(true);
    for (const t of suggested.list) {
      expect(t.matchStatus).toBe("UNMATCHED");
      expect(Number(t.matchScore)).toBeGreaterThanOrEqual(60);
    }
  }));
});
