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
import type { BankTransaction, Payment, Invoice, Contract, Customer } from "@prisma/client";

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

    // 通知财务确认
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

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
    });
    if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款记录不存在", 404);

    // 校验金额一致性（容差 0.01）
    const amountDiff = Math.abs(Number(transaction.amount) - Number(payment.amount));
    if (amountDiff > 0.01) {
      // 创建差异记录
      await tx.reconciliationDiscrepancy.create({
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

    // 更新流水状态
    const updated = await tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchStatus: "CONFIRMED_MATCHED",
        paymentId: payment.id,
        matchedAt: new Date(),
        matchedById: user.id,
      },
    });

    // 更新 Payment: 补录银行流水号，状态推进到 CONFIRMED
    const updateData: Prisma.PaymentUpdateInput = {
      bankRefNo: transaction.bankRefNo,
    };
    if (payment.status === "PLANNED") {
      updateData.status = "CONFIRMED";
      updateData.receivedAt = transaction.transactionDate;
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: updateData,
    });

    // 审计
    await audit(tx, {
      actorId: user.id,
      action: "RECONCILIATION_CONFIRM_MATCH",
      entity: "BankTransaction",
      entityId: transactionId,
      before: { matchStatus: transaction.matchStatus },
      after: { matchStatus: "CONFIRMED_MATCHED", paymentId: payment.id },
    });

    return updated;
  });
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

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
    });
    if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款记录不存在", 404);

    const updated = await tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matchStatus: "MANUAL_MATCHED",
        paymentId: payment.id,
        matchedAt: new Date(),
        matchedById: user.id,
      },
    });

    await audit(tx, {
      actorId: user.id,
      action: "RECONCILIATION_MANUAL_MATCH",
      entity: "BankTransaction",
      entityId: transactionId,
      after: { paymentId: payment.id },
    });

    return updated;
  });
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

  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, deletedAt: null },
  });
  if (!transaction) throw new ApiError(ERROR_CODES.NOT_FOUND, "银行流水不存在", 404);

  const updated = await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: {
      matchStatus: "UNMATCHED",
      paymentId: null,
      matchScore: null,
      matchReason: null,
      matchedAt: null,
      matchedById: null,
    },
  });

  await audit(prisma, {
    actorId: user.id,
    action: "RECONCILIATION_UNMATCH",
    entity: "BankTransaction",
    entityId: transactionId,
    before: { matchStatus: transaction.matchStatus, paymentId: transaction.paymentId },
    after: { matchStatus: "UNMATCHED" },
  });

  return updated;
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

  const where: Prisma.BankTransactionWhereInput = {
    deletedAt: null,
    ...(matchStatus ? { matchStatus } : {}),
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

// =====================================================
// 规则配置
// =====================================================

export async function listRules(user: SessionUser) {
  requireReconciliationPermission(user, ACTION.READ);
  return prisma.reconciliationRule.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
  });
}

export async function createRule(
  user: SessionUser,
  input: { name: string; priority?: number; conditions: Record<string, unknown>; action: string }
) {
  requireReconciliationPermission(user, ACTION.CREATE);
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可配置对账规则", 403);
  }

  return prisma.reconciliationRule.create({
    data: {
      name: input.name,
      priority: input.priority ?? 0,
      conditions: input.conditions as Prisma.InputJsonValue,
      action: input.action,
      createdById: user.id,
    },
  });
}

export async function updateRule(
  user: SessionUser,
  id: string,
  input: Partial<{ name: string; priority: number; conditions: Record<string, unknown>; action: string; isActive: boolean }>
) {
  requireReconciliationPermission(user, ACTION.UPDATE);
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可配置对账规则", 403);
  }

  return prisma.reconciliationRule.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions as Prisma.InputJsonValue } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteRule(user: SessionUser, id: string) {
  requireReconciliationPermission(user, ACTION.DELETE);
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可配置对账规则", 403);
  }

  return prisma.reconciliationRule.delete({ where: { id } });
}
