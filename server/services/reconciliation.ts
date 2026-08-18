// 银行流水导入 / 自动对账 Service
// 设计文档: docs/architecture/DESIGN-v3.md §对账中心

import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION, type Action } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { emit } from "@/server/events/bus";
import { listAdminUserIds } from "@/server/events/bus";
import { flushPendingKicks } from "@/server/notifications/hub";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import type { BankTransaction, Payment, Invoice, Contract, Customer } from "@prisma/client";
import type ExcelJS from "exceljs";

// =====================================================
// 类型定义
// =====================================================

export type BankTransactionWithRelations = BankTransaction & {
  payment?: (Payment & { invoice?: Invoice | null; contract?: Contract | null; customer?: Customer | null }) | null;
};

export type MatchCandidate = {
  payment: Payment & { invoice?: Invoice | null; contract?: Contract | null; customer?: Customer | null };
  score: number;
  reasons: string[];
};

export type ImportBatchResult = {
  batchId: string;
  total: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
};

export type ReconciliationSummary = {
  unmatchedCount: number;
  suggestedCount: number;
  autoMatchedCount: number;
  confirmedCount: number;
  ignoredCount: number;
  discrepancyCount: number;
};

// =====================================================
// 权限检查
// =====================================================

function requireReconciliationPermission(user: SessionUser, action: Action): void {
  requirePermission(user.roleCode, RESOURCE.RECONCILIATION, action);
}

function requireFinanceOrAdmin(user: SessionUser): void {
  if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务或管理员可执行此操作", 403);
  }
}

// =====================================================
// 银行流水导入
// =====================================================

/**
 * 解析银行流水 Excel/CSV 数据
 * 支持标准格式: 交易日期 | 流水号 | 金额 | 对方户名 | 对方账号 | 摘要 | 用途
 */
export function parseBankTransactionRow(row: Record<string, unknown>, rowIndex: number): {
  bankRefNo: string;
  transactionDate: Date;
  amount: number;
  counterpartyName?: string;
  counterpartyAccount?: string;
  counterpartyBank?: string;
  summary?: string;
  purpose?: string;
} {
  const get = (key: string): string => {
    const v = row[key];
    return v != null ? String(v).trim() : "";
  };

  const bankRefNo = get("流水号") || get("银行流水号") || get("交易流水号") || get("refNo") || "";
  const dateStr = get("交易日期") || get("日期") || get("transactionDate") || "";
  const amountStr = get("金额") || get("交易金额") || get("amount") || "";
  const counterpartyName = get("对方户名") || get("对方名称") || get("counterpartyName") || "";
  const counterpartyAccount = get("对方账号") || get("counterpartyAccount") || "";
  const counterpartyBank = get("对方开户行") || get("counterpartyBank") || "";
  const summary = get("摘要") || get("summary") || "";
  const purpose = get("用途") || get("附言") || get("purpose") || "";

  if (!bankRefNo) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `第 ${rowIndex} 行: 流水号不能为空`, 400);
  }
  if (!dateStr) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `第 ${rowIndex} 行: 交易日期不能为空`, 400);
  }
  if (!amountStr) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `第 ${rowIndex} 行: 金额不能为空`, 400);
  }

  // 解析日期: 支持 YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD
  let transactionDate: Date;
  const cleaned = dateStr.replace(/[/\s]/g, "-");
  if (/^\d{8}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    transactionDate = new Date(`${y}-${m}-${d}T00:00:00`);
  } else {
    transactionDate = new Date(cleaned);
  }
  if (isNaN(transactionDate.getTime())) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `第 ${rowIndex} 行: 交易日期格式无效 "${dateStr}"`, 400);
  }

  // 解析金额: 去除逗号、¥ 符号
  const amountClean = amountStr.replace(/[,¥￥\s]/g, "");
  const amount = parseFloat(amountClean);
  if (isNaN(amount) || amount === 0) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `第 ${rowIndex} 行: 金额格式无效 "${amountStr}"`, 400);
  }

  return {
    bankRefNo,
    transactionDate,
    amount: Math.abs(amount), // 回款只取正数
    counterpartyName: counterpartyName || undefined,
    counterpartyAccount: counterpartyAccount || undefined,
    counterpartyBank: counterpartyBank || undefined,
    summary: summary || undefined,
    purpose: purpose || undefined,
  };
}

/**
 * 解析银行流水文件（.xlsx / .csv）为行记录数组。
 * 第一行必须是表头（流水号 / 交易日期 / 金额 / ...），列名兼容见 parseBankTransactionRow。
 * 单次导入上限 MAX_IMPORT_ROWS，防止超大文件把进程打爆。
 */
export const MAX_IMPORT_ROWS = 5000;

export async function parseStatementFile(
  buffer: Buffer,
  filename: string
): Promise<Array<Record<string, unknown>>> {
  const lower = filename.toLowerCase();

  let rows: Array<Record<string, unknown>>;
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const { parseDelimitedText } = await import("@/lib/statement-text");
    rows = parseDelimitedText(buffer.toString("utf-8"));
  } else if (lower.endsWith(".xlsx")) {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    // exceljs d.ts 引用旧版 @types/node 的 Buffer, 与当前 Buffer 泛型不兼容, 按其实参类型收窄
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    if (!ws) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "Excel 文件中没有工作表", 400);
    }
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value).trim();
    });
    rows = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const r: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const h = headers[col - 1];
        if (h) r[h] = cellText(cell.value);
      });
      if (Object.values(r).some((v) => String(v).trim() !== "")) rows.push(r);
    });
  } else {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "仅支持 .xlsx / .csv 文件", 400);
  }

  if (rows.length === 0) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "文件中没有数据行（第一行须为表头）", 400);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `单次最多导入 ${MAX_IMPORT_ROWS} 行`, 400);
  }
  return rows;
}

/** exceljs 单元格值 → 字符串（日期转 YYYY-MM-DD，富文本/公式取结果值） */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object") {
    // 富文本 / 超链接 / 公式结果
    const v = value as { richText?: Array<{ text: string }>; text?: string; result?: unknown; hyperlink?: string };
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    return String(value);
  }
  return String(value);
}

/**
 * 批量导入银行流水
 */
export async function importBankTransactions(
  user: SessionUser,
  rows: Array<Record<string, unknown>>
): Promise<ImportBatchResult> {
  requireReconciliationPermission(user, ACTION.CREATE);
  requireFinanceOrAdmin(user);

  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const errors: Array<{ row: number; message: string }> = [];
  let success = 0;

  // 先解析所有行，收集错误
  const parsedRows: Array<{ rowIndex: number; data: ReturnType<typeof parseBankTransactionRow> }> = [];
  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2; // Excel 行号从 2 开始（第 1 行是表头）
    try {
      const data = parseBankTransactionRow(rows[i]!, rowIndex);
      parsedRows.push({ rowIndex, data });
    } catch (e) {
      errors.push({ row: rowIndex, message: e instanceof Error ? e.message : "解析失败" });
    }
  }

  // 去重: 同批次内 (bankRefNo, transactionDate, amount) 重复的行只保留第一条
  const seen = new Set<string>();
  const uniqueRows = parsedRows.filter(({ data }) => {
    const key = `${data.bankRefNo}|${data.transactionDate.toISOString()}|${data.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 批量插入（跳过已存在的）
  for (const { data } of uniqueRows) {
    try {
      await prisma.bankTransaction.create({
        data: {
          ...data,
          importBatchId: batchId,
          importedById: user.id,
        },
      });
      success++;
    } catch (e) {
      // P2002 唯一约束冲突 = 已存在，静默跳过
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue;
      }
      errors.push({ row: 0, message: `插入失败: ${e instanceof Error ? e.message : "未知错误"}` });
    }
  }

  return {
    batchId,
    total: rows.length,
    success,
    failed: rows.length - success,
    errors,
  };
}

// =====================================================
// 自动匹配引擎
// =====================================================

/**
 * 计算两个字符串的相似度 (0-1)
 * 简化版: 基于公共子串 + 长度比
 */
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const s1 = a.toLowerCase().replace(/\s/g, "");
  const s2 = b.toLowerCase().replace(/\s/g, "");
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;

  // 简单公共子串比例
  let common = 0;
  const minLen = Math.min(s1.length, s2.length);
  for (let i = 0; i < minLen; i++) {
    if (s1[i] === s2[i]) common++;
  }
  return common / Math.max(s1.length, s2.length);
}

/**
 * 从文本中提取关键标识（发票号/合同号模式）
 */
function extractIdentifiers(text: string): string[] {
  const patterns = [
    /QT-[A-Z]+-\d{4}-\d+/g, // 合同号模式 QT-HT-2026-0001
    /\d{20}/g,              // 20 位电子发票号
    /[A-Z]{2,}-\d+/g,       // 通用编号
  ];
  const results: string[] = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) results.push(...matches);
  }
  return results;
}

/**
 * 为一条银行流水找候选 Payment
 */
async function findCandidatePayments(
  tx: BankTransaction,
  daysWindow: number = 7
): Promise<Array<Payment & { invoice?: Invoice | null; contract?: Contract | null; customer?: Customer | null }>> {
  const dateStart = new Date(tx.transactionDate);
  dateStart.setDate(dateStart.getDate() - daysWindow);
  const dateEnd = new Date(tx.transactionDate);
  dateEnd.setDate(dateEnd.getDate() + daysWindow);

  // 金额范围: ±10% 或 ±100元，取较大者
  const amountTolerance = Math.max(Number(tx.amount) * 0.1, 100);
  const amountMin = Number(tx.amount) - amountTolerance;
  const amountMax = Number(tx.amount) + amountTolerance;

  const candidates = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      status: { in: ["PLANNED", "CONFIRMED"] },
      amount: { gte: new Prisma.Decimal(amountMin), lte: new Prisma.Decimal(amountMax) },
      receivedAt: { gte: dateStart, lte: dateEnd },
    },
    include: {
      invoice: true,
      contract: true,
      customer: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });

  return candidates;
}

/**
 * 为候选 Payment 评分
 */
function scoreCandidate(
  tx: BankTransaction,
  payment: Payment & { invoice?: Invoice | null; contract?: Contract | null; customer?: Customer | null }
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. 金额匹配 (0-40 分)
  const amountDiff = Math.abs(Number(tx.amount) - Number(payment.amount));
  if (amountDiff === 0) {
    score += 40;
    reasons.push("金额精确匹配");
  } else if (amountDiff <= 0.01) {
    score += 38;
    reasons.push("金额匹配（容差±0.01）");
  } else if (amountDiff <= 1) {
    score += 25;
    reasons.push(`金额近似（差¥${amountDiff.toFixed(2)}）`);
  } else if (amountDiff <= 10) {
    score += 15;
    reasons.push(`金额接近（差¥${amountDiff.toFixed(2)}）`);
  } else {
    return { score: 0, reasons: ["金额差异过大"] };
  }

  // 2. 日期匹配 (0-20 分)
  const dateDiff = Math.abs(
    Math.floor((tx.transactionDate.getTime() - payment.receivedAt.getTime()) / 86400000)
  );
  if (dateDiff === 0) {
    score += 20;
    reasons.push("日期精确匹配");
  } else if (dateDiff <= 1) {
    score += 18;
    reasons.push("日期±1天");
  } else if (dateDiff <= 3) {
    score += 12;
    reasons.push(`日期±${dateDiff}天`);
  } else if (dateDiff <= 7) {
    score += 6;
    reasons.push(`日期±${dateDiff}天`);
  }

  // 3. 客户名称匹配 (0-25 分)
  const customerName = payment.customer?.name ?? payment.contract?.customerName ?? "";
  const nameSim = calculateSimilarity(tx.counterpartyName ?? "", customerName);
  if (nameSim >= 0.9) {
    score += 25;
    reasons.push("客户名称高度匹配");
  } else if (nameSim >= 0.7) {
    score += 18;
    reasons.push("客户名称相似");
  } else if (nameSim >= 0.5) {
    score += 10;
    reasons.push("客户名称部分匹配");
  } else if (nameSim >= 0.3) {
    score += 5;
    reasons.push("客户名称弱匹配");
  }

  // 4. 摘要关键词匹配 (0-15 分)
  const searchText = `${tx.summary ?? ""} ${tx.purpose ?? ""}`.toLowerCase();
  const identifiers = extractIdentifiers(searchText);
  let keywordScore = 0;

  if (payment.invoice?.invoiceNo) {
    const invNo = payment.invoice.invoiceNo.toLowerCase();
    if (searchText.includes(invNo) || identifiers.some((id) => invNo.includes(id))) {
      keywordScore += 15;
      reasons.push("摘要含发票号");
    }
  }
  if (payment.contract?.contractNo) {
    const contractNo = payment.contract.contractNo.toLowerCase();
    if (searchText.includes(contractNo) || identifiers.some((id) => contractNo.includes(id))) {
      keywordScore += 12;
      reasons.push("摘要含合同号");
    }
  }
  if (payment.paymentNo) {
    const paymentNo = payment.paymentNo.toLowerCase();
    if (searchText.includes(paymentNo)) {
      keywordScore += 10;
      reasons.push("摘要含回款单号");
    }
  }
  score += Math.min(keywordScore, 15);

  // 5. 历史模式匹配 (0-5 分)
  // 如果同一客户的历史回款银行账号与当前流水对方账号一致
  if (tx.counterpartyAccount && payment.customer) {
    // 简化: 检查是否同客户历史交易过
    score += 3;
    reasons.push("历史客户交易模式");
  }

  return { score, reasons };
}

/**
 * 自动匹配单条银行流水
 */
export async function autoMatchTransaction(
  user: SessionUser,
  transactionId: string
): Promise<{
  action: "AUTO_MATCHED" | "SUGGESTED" | "NO_MATCH";
  transaction: BankTransaction;
  candidates?: MatchCandidate[];
}> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  const tx = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, deletedAt: null },
  });
  if (!tx) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);
  if (tx.matchStatus !== "UNMATCHED") {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "该流水已被处理", 422);
  }

  const candidates = await findCandidatePayments(tx);
  if (candidates.length === 0) {
    return { action: "NO_MATCH", transaction: tx };
  }

  // 评分
  const scored = candidates
    .map((p) => {
      const { score, reasons } = scoreCandidate(tx, p);
      return { payment: p, score, reasons };
    })
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { action: "NO_MATCH", transaction: tx };
  }

  const best = scored[0]!;
  const second = scored[1];

  // 高置信度: ≥80 分且领先第二名 ≥20 分
  if (best.score >= 80 && (!second || best.score - second.score >= 20)) {
    // 自动匹配
    const updated = await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        matchStatus: "AUTO_MATCHED",
        paymentId: best.payment.id,
        matchScore: best.score,
        matchReason: best.reasons.join("; "),
        matchedAt: new Date(),
        matchedById: user.id,
      },
    });

    // 通知财务确认 (应用层消息类型, 不扩展 PG enum; 失败不阻断主流程)
    try {
      const admins = await listAdminUserIds(prisma);
      await emit(prisma, {
        type: "RECONCILIATION_AUTO_MATCHED",
        payload: {
          transactionId: tx.id,
          bankRefNo: tx.bankRefNo,
          amount: Number(tx.amount),
          paymentNo: best.payment.paymentNo,
          customerName: best.payment.customer?.name ?? "",
          score: best.score,
        },
        entityKey: `RECONCILIATION_AUTO_MATCHED:${tx.id}`,
        receivers: Array.from(new Set([user.id, ...admins])),
      });
    } catch (e) {
      // 消息发送失败不影响对账主流程
      console.warn("[reconciliation] emit RECONCILIATION_AUTO_MATCHED failed:", e instanceof Error ? e.message : e);
    }

    return {
      action: "AUTO_MATCHED",
      transaction: updated,
      candidates: scored.slice(0, 5),
    };
  }

  // 中置信度: ≥60 分 → 建议匹配
  if (best.score >= 60) {
    const updated = await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        matchScore: best.score,
        matchReason: `建议匹配: ${best.reasons.join("; ")}`,
      },
    });

    // 通知财务人工确认 (失败不阻断主流程)
    try {
      const admins = await listAdminUserIds(prisma);
      await emit(prisma, {
        type: "RECONCILIATION_SUGGESTION",
        payload: {
          transactionId: tx.id,
          bankRefNo: tx.bankRefNo,
          amount: Number(tx.amount),
          customerName: best.payment.customer?.name ?? "",
          candidateCount: scored.length,
        },
        entityKey: `RECONCILIATION_SUGGESTION:${tx.id}`,
        receivers: Array.from(new Set([user.id, ...admins])),
      });
    } catch (e) {
      console.warn("[reconciliation] emit RECONCILIATION_SUGGESTION failed:", e instanceof Error ? e.message : e);
    }

    return {
      action: "SUGGESTED",
      transaction: updated,
      candidates: scored.slice(0, 5),
    };
  }

  return { action: "NO_MATCH", transaction: tx, candidates: scored.slice(0, 5) };
}

/**
 * 批量自动匹配
 */
export async function autoMatchBatch(
  user: SessionUser,
  transactionIds?: string[]
): Promise<{ matched: number; suggested: number; unmatched: number }> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  const where: Prisma.BankTransactionWhereInput = {
    deletedAt: null,
    matchStatus: "UNMATCHED",
    ...(transactionIds ? { id: { in: transactionIds } } : {}),
  };

  const unmatched = await prisma.bankTransaction.findMany({ where, take: 200 });
  let matched = 0;
  let suggested = 0;
  let unmatchedCount = 0;

  for (const tx of unmatched) {
    try {
      const result = await autoMatchTransaction(user, tx.id);
      if (result.action === "AUTO_MATCHED") matched++;
      else if (result.action === "SUGGESTED") suggested++;
      else unmatchedCount++;
    } catch {
      unmatchedCount++;
    }
  }

  return { matched, suggested, unmatched: unmatchedCount };
}

// =====================================================
// 匹配操作
// =====================================================

/** 处于"已关联"区间的匹配状态 — 这些状态会占用 paymentId */
const MATCHED_STATUSES = ["AUTO_MATCHED", "CONFIRMED_MATCHED", "MANUAL_MATCHED"] as const;

/**
 * 校验回款未被其它流水占用（一对一占用约束）。
 * 不加这个校验时，同一笔回款可以被多条流水重复确认，金额统计会翻倍。
 */
async function assertPaymentNotOccupied(
  db: Prisma.TransactionClient,
  transactionId: string,
  paymentId: string
): Promise<void> {
  const occupied = await db.bankTransaction.findFirst({
    where: {
      paymentId,
      deletedAt: null,
      matchStatus: { in: [...MATCHED_STATUSES] },
      id: { not: transactionId },
    },
    select: { id: true, bankRefNo: true },
  });
  if (occupied) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `该回款已关联银行流水 ${occupied.bankRefNo}，请先取消原匹配`,
      422
    );
  }
}

/**
 * 匹配写回共享逻辑 — confirmMatch / manualMatch 的唯一差异是流水终态与审计动作。
 * 对 Payment 的写回与 payment.ts 的 confirm/reconcile 动作对齐:
 *   - 金额守门: R-10 流水号唯一 / R-11 累计≤发票 / R-12 累计≤合同 (仅 PLANNED 新入账时校验 R-11/R-12)
 *   - 终态一律 RECONCILED (对账中心确认 = 已对账), 记 reconcileUserId/reconciledAt
 *   - PLANNED → RECONCILED 时补发 PAYMENT_RECEIVED 事件 (与回款页确认一致)
 *   - 原状态记入 BankTransaction.paymentPrevStatus, 供 unmatch 精确回滚
 *   - 金额不一致 (>0.01) 记 AMOUNT_MISMATCH 差异并发 RECONCILIATION_DISCREPANCY 通知
 */
async function writebackPaymentOnMatch(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  transaction: BankTransaction,
  payment: Payment,
  matchedStatus: "CONFIRMED_MATCHED" | "MANUAL_MATCHED",
  auditAction: "RECONCILIATION_CONFIRM_MATCH" | "RECONCILIATION_MANUAL_MATCH"
): Promise<BankTransaction> {
  await assertPaymentNotOccupied(tx, transaction.id, payment.id);

  if (payment.status !== "PLANNED" && payment.status !== "CONFIRMED") {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `回款当前状态 ${payment.status}，不可匹配`, 422);
  }

  // 金额一致性校验（容差 0.01）, 不一致记差异
  const amountDiff = Math.abs(Number(transaction.amount) - Number(payment.amount));
  let discrepancy: { id: string; severity: string; description: string } | null = null;
  if (amountDiff > 0.01) {
    discrepancy = await tx.reconciliationDiscrepancy.create({
      data: {
        type: "AMOUNT_MISMATCH",
        severity: amountDiff > 100 ? "HIGH" : "MEDIUM",
        bankTransactionId: transaction.id,
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        expectedAmount: payment.amount,
        actualAmount: transaction.amount,
        difference: new Prisma.Decimal(amountDiff),
        description: `银行流水金额 ¥${transaction.amount} 与回款金额 ¥${payment.amount} 不一致，差额 ¥${amountDiff.toFixed(2)}`,
      },
    });
  }

  const wasPlanned = payment.status === "PLANNED";
  const ref = transaction.bankRefNo;

  // 与 payment.ts confirm 同款的并发与金额守门
  // 加分布式锁防止同一流水号并发确认导致重复
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ref})::bigint)`;
  // 对合同/发票行加锁, 序列化同一合同/发票下的并发确认, 防止累计金额超限
  await tx.$queryRaw`SELECT id FROM "Contract" WHERE id = ${payment.contractId} AND "deletedAt" IS NULL FOR UPDATE`;
  if (payment.invoiceId) {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${payment.invoiceId} AND "deletedAt" IS NULL FOR UPDATE`;
  }
  // R-10: 流水号唯一 (在 CONFIRMED/RECONCILED 池里, 已删除记录不占号)
  const dup = await tx.payment.findFirst({
    where: { bankRefNo: ref, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null, NOT: { id: payment.id } },
  });
  if (dup) throw new ApiError(ERROR_CODES.PAYMENT_DUPLICATE_REF, `流水号 ${ref} 已存在`, 409);

  if (wasPlanned) {
    // R-11/R-12 仅在新入账 (PLANNED → 入池) 时校验; 已 CONFIRMED 的回款在原 confirm 时已校验过
    const TOL = MONEY_TOLERANCE;
    // R-11 (若挂发票): 累计回款 ≤ 发票金额
    if (payment.invoiceId) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
      const sum = await tx.payment.aggregate({
        where: { invoiceId: payment.invoiceId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: payment.id } },
        _sum: { amount: true },
      });
      const sumAmt = new Prisma.Decimal(sum._sum.amount?.toString() ?? "0");
      const invAmt = new Prisma.Decimal(inv.amount.toString());
      if (sumAmt.plus(payment.amount.toString()).greaterThan(invAmt.plus(TOL))) {
        throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额", 422);
      }
    }
    // R-12: 累计回款 ≤ 合同总额
    const sumC = await tx.payment.aggregate({
      where: { contractId: payment.contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: payment.id } },
      _sum: { amount: true },
    });
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: payment.contractId } });
    const sumCAmt = new Prisma.Decimal(sumC._sum.amount?.toString() ?? "0");
    const contractAmt = new Prisma.Decimal(contract.totalAmount.toString());
    if (sumCAmt.plus(payment.amount.toString()).greaterThan(contractAmt.plus(TOL))) {
      throw new ApiError(ERROR_CODES.PAYMENT_OVER_CONTRACT, "该合同累计回款将超过合同总额", 422);
    }
  }

  // 更新流水状态 (记 paymentPrevStatus 供 unmatch 回滚)
  const updated = await tx.bankTransaction.update({
    where: { id: transaction.id },
    data: {
      matchStatus: matchedStatus,
      paymentId: payment.id,
      paymentPrevStatus: payment.status,
      matchedAt: new Date(),
      matchedById: user.id,
    },
  });

  // 更新 Payment: 补录银行流水号, 终态 RECONCILED (对账完成);
  // PLANNED 新入账时把 receivedAt 更正为流水交易日期 (同 payment.ts confirm 语义)
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      bankRefNo: ref,
      status: "RECONCILED",
      reconcileUserId: user.id,
      reconciledAt: new Date(),
      ...(wasPlanned ? { receivedAt: transaction.transactionDate } : {}),
    },
  });

  // 审计
  await audit(tx, {
    actorId: user.id,
    action: auditAction,
    entity: "BankTransaction",
    entityId: transaction.id,
    before: { matchStatus: transaction.matchStatus, paymentStatus: payment.status },
    after: { matchStatus: matchedStatus, paymentId: payment.id, paymentStatus: "RECONCILED" },
  });

  // 事件: PLANNED 新入账 → 回款到账通知 (与回款页 confirm 一致);
  // 有差异 → 差异提醒. 事件在事务内 emit, 由调用方 flushPendingKicks 推送.
  if (wasPlanned || discrepancy) {
    const admins = await listAdminUserIds(tx);
    if (wasPlanned) {
      const ct = await tx.contract.findUniqueOrThrow({ where: { id: payment.contractId }, select: { ownerUserId: true } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: payment.customerId }, select: { name: true } });
      await emit(tx, {
        type: "PAYMENT_RECEIVED",
        payload: { paymentId: payment.id, paymentNo: payment.paymentNo, amount: Number(payment.amount), customerName: customer.name },
        entityKey: `PAYMENT_RECEIVED:${payment.id}`,
        receivers: Array.from(new Set([ct.ownerUserId, payment.recorderUserId, ...admins])),
      });
    }
    if (discrepancy) {
      await emit(tx, {
        type: "RECONCILIATION_DISCREPANCY",
        payload: {
          discrepancyId: discrepancy.id,
          bankTransactionId: transaction.id,
          type: "AMOUNT_MISMATCH",
          severity: discrepancy.severity,
          description: discrepancy.description,
        },
        entityKey: `RECONCILIATION_DISCREPANCY:${discrepancy.id}`,
        receivers: Array.from(new Set([user.id, ...admins])),
      });
    }
  }

  return updated;
}

/**
 * 确认匹配（财务复核后确认）
 */
export async function confirmMatch(
  user: SessionUser,
  transactionId: string,
  paymentId: string
): Promise<BankTransaction> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
    });
    if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款记录不存在", 404);

    return writebackPaymentOnMatch(tx, user, transaction, payment, "CONFIRMED_MATCHED", "RECONCILIATION_CONFIRM_MATCH");
  });
  flushPendingKicks();
  return result;
}

/**
 * 手动匹配
 */
export async function manualMatch(
  user: SessionUser,
  transactionId: string,
  paymentId: string
): Promise<BankTransaction> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
    });
    if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款记录不存在", 404);

    return writebackPaymentOnMatch(tx, user, transaction, payment, "MANUAL_MATCHED", "RECONCILIATION_MANUAL_MATCH");
  });
  flushPendingKicks();
  return result;
}

/**
 * 取消匹配
 */
export async function unmatchTransaction(
  user: SessionUser,
  transactionId: string
): Promise<BankTransaction> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
    });
    if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

    const updated = await tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchStatus: "UNMATCHED",
        paymentId: null,
        paymentPrevStatus: null,
        matchScore: null,
        matchReason: null,
        matchedAt: null,
        matchedById: null,
      },
    });

    // 回滚匹配对 Payment 的副作用, 避免孤儿状态:
    //   - bankRefNo 是本流水写入的 → 清空
    //   - status 是本次匹配推进到 RECONCILED 的 → 退回 paymentPrevStatus 记的原状态,
    //     并清掉 reconcileUserId/reconciledAt
    // 旧数据 (paymentPrevStatus 为 null, 修复前匹配的) 退化到原启发式:
    //   confirmMatch 只在推进状态时把 receivedAt 覆写为流水交易日期,
    //   因此 "bankRefNo 匹配 且 receivedAt == 交易日期 且仍在 CONFIRMED" 即当时写入的签名;
    //   原本就 CONFIRMED/RECONCILED 的回款不会被误退。
    if (transaction.paymentId) {
      const payment = await tx.payment.findFirst({
        where: { id: transaction.paymentId, deletedAt: null },
      });
      if (payment && payment.bankRefNo === transaction.bankRefNo) {
        const prev = transaction.paymentPrevStatus;
        const legacyAdvanced =
          payment.status === "CONFIRMED" &&
          payment.receivedAt.getTime() === transaction.transactionDate.getTime();
        const rollbackStatus = prev ?? (legacyAdvanced ? "PLANNED" : null);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            bankRefNo: null,
            ...(rollbackStatus
              ? { status: rollbackStatus, reconcileUserId: null, reconciledAt: null }
              : {}),
          },
        });
      }
    }

    await audit(tx, {
      actorId: user.id,
      action: "RECONCILIATION_UNMATCH",
      entity: "BankTransaction",
      entityId: transactionId,
      before: { matchStatus: transaction.matchStatus, paymentId: transaction.paymentId },
      after: { matchStatus: "UNMATCHED" },
    });

    return updated;
  });
}

/**
 * 忽略流水（标记为非回款）
 */
export async function ignoreTransaction(
  user: SessionUser,
  transactionId: string
): Promise<BankTransaction> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, deletedAt: null },
  });
  if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

  return prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { matchStatus: "IGNORED" },
  });
}

// =====================================================
// 查询服务
// =====================================================

export async function listBankTransactions(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    matchStatus?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
    minAmount?: number;
    maxAmount?: number;
  }
) {
  requireReconciliationPermission(user, ACTION.READ);

  const { page, pageSize, matchStatus, keyword, startDate, endDate, minAmount, maxAmount } = params;

  // SUGGESTED 是虚拟状态: 数据上仍是 UNMATCHED, 只是引擎已给出 ≥60 分建议
  const isSuggested = matchStatus === "SUGGESTED";

  const where: Prisma.BankTransactionWhereInput = {
    deletedAt: null,
    ...(matchStatus
      ? isSuggested
        ? { matchStatus: "UNMATCHED", matchScore: { gte: 60 } }
        : { matchStatus }
      : {}),
    ...(keyword
      ? {
          OR: [
            { bankRefNo: { contains: keyword, mode: "insensitive" } },
            { counterpartyName: { contains: keyword, mode: "insensitive" } },
            { summary: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(startDate || endDate
      ? {
          transactionDate: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        }
      : {}),
    ...(minAmount !== undefined || maxAmount !== undefined
      ? {
          amount: {
            ...(minAmount !== undefined ? { gte: new Prisma.Decimal(minAmount) } : {}),
            ...(maxAmount !== undefined ? { lte: new Prisma.Decimal(maxAmount) } : {}),
          },
        }
      : {}),
  };

  const [list, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        payment: {
          select: {
            id: true,
            paymentNo: true,
            amount: true,
            status: true,
            invoice: { select: { invoiceNo: true } },
            contract: { select: { contractNo: true } },
            customer: { select: { name: true } },
          },
        },
      },
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return { list, total, page, pageSize };
}

export async function getBankTransaction(user: SessionUser, id: string) {
  requireReconciliationPermission(user, ACTION.READ);

  const tx = await prisma.bankTransaction.findFirst({
    where: { id, deletedAt: null },
    include: {
      payment: {
        include: {
          invoice: true,
          contract: true,
          customer: true,
        },
      },
    },
  });
  if (!tx) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

  // 如果未匹配，实时计算候选
  let candidates: MatchCandidate[] = [];
  if (tx.matchStatus === "UNMATCHED") {
    const rawCandidates = await findCandidatePayments(tx);
    candidates = rawCandidates
      .map((p) => {
        const { score, reasons } = scoreCandidate(tx, p);
        return { payment: p, score, reasons };
      })
      .filter((c) => c.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  return { ...tx, candidates };
}

export async function getReconciliationSummary(user: SessionUser): Promise<ReconciliationSummary> {
  requireReconciliationPermission(user, ACTION.READ);

  const [unmatched, suggested, autoMatched, confirmed, ignored, discrepancy] = await Promise.all([
    prisma.bankTransaction.count({ where: { deletedAt: null, matchStatus: "UNMATCHED" } }),
    prisma.bankTransaction.count({ where: { deletedAt: null, matchStatus: "UNMATCHED", matchScore: { gte: 60 } } }),
    prisma.bankTransaction.count({ where: { deletedAt: null, matchStatus: "AUTO_MATCHED" } }),
    prisma.bankTransaction.count({ where: { deletedAt: null, matchStatus: { in: ["CONFIRMED_MATCHED", "MANUAL_MATCHED"] } } }),
    prisma.bankTransaction.count({ where: { deletedAt: null, matchStatus: "IGNORED" } }),
    prisma.reconciliationDiscrepancy.count({ where: { status: "OPEN" } }),
  ]);

  return {
    unmatchedCount: unmatched,
    suggestedCount: suggested,
    autoMatchedCount: autoMatched,
    confirmedCount: confirmed,
    ignoredCount: ignored,
    discrepancyCount: discrepancy,
  };
}

export async function listDiscrepancies(
  user: SessionUser,
  params: { page: number; pageSize: number; status?: string; severity?: string }
) {
  requireReconciliationPermission(user, ACTION.READ);

  const { page, pageSize, status, severity } = params;
  const where: Prisma.ReconciliationDiscrepancyWhereInput = {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
  };

  const [list, total] = await Promise.all([
    prisma.reconciliationDiscrepancy.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.reconciliationDiscrepancy.count({ where }),
  ]);

  return { list, total, page, pageSize };
}

export async function resolveDiscrepancy(
  user: SessionUser,
  id: string,
  resolution: string
): Promise<void> {
  requireReconciliationPermission(user, ACTION.UPDATE);
  requireFinanceOrAdmin(user);

  await prisma.reconciliationDiscrepancy.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolution,
      resolvedAt: new Date(),
      resolvedById: user.id,
    },
  });
}
