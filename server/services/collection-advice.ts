// 智能催款建议 — 数据组装层 (Phase 5 接线: smart-collection 规则引擎 ← 真实业务数据)
//
// 职责: 从逾期发票 + 回款/催收历史组装 PaymentHabit / CustomerPaymentPattern,
//   调 smart-collection 规则引擎生成按紧急度排序的催款建议。
// 口径: 与 statistics.ts getInvoiceAging (basis=due) 一致 —
//   计龄基准 dueDate ?? actualIssueDate, remaining > 0.01 才纳入; 仅 daysOverdue > 0 的进入催款池。
//   owner 行级隔离与账龄页同口径 (ownerViaContract)。
// 权限: DUNNING.READ (建议的受众就是做催收的角色: ADMIN/FINANCE CRUD, SALES/EXPERT CR, OPS R)。
// 注意: smart-collection 的话术规则里 preferredMethod 用 snake_case 取值 ("bank_transfer"/"wechat_pay"),
//   与 Payment.method 的 DB 值 (BANK_TRANSFER/WECHAT/...) 不一致 — 组装层负责归一化。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ownerViaContract } from "@/lib/ownership";
import {
  generateSmartCollectionAdvice,
  type CollectionRecommendation,
  type CustomerPaymentPattern,
  type PaymentHabit
} from "@/server/services/smart-collection";

// 按时付款宽限: 到期日后 3 天内到账仍计按时 (对齐业务宽限期话术)
const ON_TIME_GRACE_DAYS = 3;
// 建议清单上限: 催款是人工动作, 超过这个量的清单没有可执行性
const MAX_RECOMMENDATIONS = 50;

const DAY_MS = 86_400_000;

export type CollectionAdviceItem = CollectionRecommendation & {
  /** 该合同下最逾期的一张发票, 供前端直接打开催收 Drawer */
  invoiceId: string;
  invoiceNo: string;
  ownerName: string | null;
};

export type CollectionAdviceResult = {
  items: CollectionAdviceItem[];
  totalOverdueContracts: number;
  totalOutstanding: number;
  generatedAt: string;
};

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

/** Payment.method (DB 大写枚举串) → smart-collection 话术规则的 snake_case 取值 */
function normalizeMethod(method: string): string {
  switch (method) {
    case "BANK_TRANSFER":
      return "bank_transfer";
    case "WECHAT":
      return "wechat_pay";
    case "ALIPAY":
      return "alipay";
    default:
      return "other";
  }
}

export async function getCollectionAdvice(user: SessionUser): Promise<CollectionAdviceResult> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.READ);
  const now = new Date();

  // 1) 逾期发票池 (口径同 getInvoiceAging basis=due; 只取 ISSUED — 未开票/红冲不在催收范围)
  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: null,
      status: "ISSUED",
      ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
    },
    select: {
      id: true,
      invoiceNo: true,
      amount: true,
      actualIssueDate: true,
      dueDate: true,
      customerId: true,
      customerName: true,
      contractId: true,
      contract: { select: { contractNo: true, owner: { select: { name: true } } } }
    }
  });
  if (invoices.length === 0) {
    return { items: [], totalOverdueContracts: 0, totalOutstanding: 0, generatedAt: now.toISOString() };
  }

  // 2) 每张发票的已回款 (仅仍生效的 CONFIRMED/RECONCILED)
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const paidMap = new Map<string, number>();
  for (const p of paid) paidMap.set(p.invoiceId!, Number(p._sum.amount ?? 0));

  // 3) 过滤出逾期行, 按合同聚合 habit (一个合同多张逾期发票 → 金额求和, 逾期取最大)
  type OverdueRow = {
    invoiceId: string;
    invoiceNo: string;
    customerId: string;
    customerName: string;
    contractId: string;
    contractNo: string;
    ownerName: string | null;
    remaining: number;
    daysOverdue: number;
  };
  const overdueRows: OverdueRow[] = [];
  for (const inv of invoices) {
    const basisDate = inv.dueDate ?? inv.actualIssueDate;
    if (!basisDate) continue;
    const remaining = new Prisma.Decimal(inv.amount).minus(paidMap.get(inv.id) ?? 0);
    if (remaining.lessThanOrEqualTo(0.01)) continue; // 0.01 容差, 同 getInvoiceAging
    const daysOverdue = daysBetween(now, new Date(basisDate));
    if (daysOverdue <= 0) continue; // 未到期不催
    overdueRows.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      customerId: inv.customerId,
      customerName: inv.customerName,
      contractId: inv.contractId,
      contractNo: inv.contract.contractNo,
      ownerName: inv.contract.owner?.name ?? null,
      remaining: remaining.toNumber(),
      daysOverdue
    });
  }
  if (overdueRows.length === 0) {
    return { items: [], totalOverdueContracts: 0, totalOutstanding: 0, generatedAt: now.toISOString() };
  }

  const byContract = new Map<string, OverdueRow>();
  for (const row of overdueRows) {
    const existing = byContract.get(row.contractId);
    if (!existing) {
      byContract.set(row.contractId, { ...row });
    } else {
      existing.remaining += row.remaining;
      if (row.daysOverdue > existing.daysOverdue) {
        // 保留最逾期那张发票的 id/单号, 前端打开催收 Drawer 用它
        existing.daysOverdue = row.daysOverdue;
        existing.invoiceId = row.invoiceId;
        existing.invoiceNo = row.invoiceNo;
      }
    }
  }

  // 4) 客户付款模式 (付款历史 + 催收响应)
  const customerIds = [...new Set(overdueRows.map((r) => r.customerId))];
  const [payments, contractCounts, dunningNotes] = await Promise.all([
    prisma.payment.findMany({
      where: {
        customerId: { in: customerIds },
        status: { in: ["CONFIRMED", "RECONCILED"] },
        deletedAt: null
      },
      select: {
        customerId: true,
        receivedAt: true,
        method: true,
        invoice: { select: { applyDate: true, dueDate: true } }
      }
    }),
    prisma.contract.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, deletedAt: null },
      _count: { _all: true }
    }),
    // DunningNote 是 invoiceId 级, 经 Invoice 反查 customerId
    prisma.dunningNote.findMany({
      where: { invoice: { customerId: { in: customerIds } } },
      select: { status: true, lastContactAt: true, invoice: { select: { customerId: true } } }
    })
  ]);

  const contractCountMap = new Map(contractCounts.map((c) => [c.customerId, c._count._all]));

  const paymentsByCustomer = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = paymentsByCustomer.get(p.customerId) ?? [];
    list.push(p);
    paymentsByCustomer.set(p.customerId, list);
  }
  const dunningByCustomer = new Map<string, typeof dunningNotes>();
  for (const d of dunningNotes) {
    const cid = d.invoice.customerId;
    const list = dunningByCustomer.get(cid) ?? [];
    list.push(d);
    dunningByCustomer.set(cid, list);
  }

  function buildPattern(customerId: string, customerName: string): CustomerPaymentPattern {
    const pays = paymentsByCustomer.get(customerId) ?? [];
    let onTime = 0;
    let late = 0;
    let totalDelayDays = 0;
    const methodCount = new Map<string, number>();
    let lastPaymentDate: Date | null = null;
    for (const p of pays) {
      const method = normalizeMethod(p.method);
      methodCount.set(method, (methodCount.get(method) ?? 0) + 1);
      if (!lastPaymentDate || p.receivedAt > lastPaymentDate) lastPaymentDate = p.receivedAt;
      const dueDate = p.invoice?.dueDate;
      if (dueDate) {
        const delay = daysBetween(p.receivedAt, new Date(dueDate));
        if (delay <= ON_TIME_GRACE_DAYS) onTime += 1;
        else {
          late += 1;
          totalDelayDays += delay;
        }
      }
    }
    const preferredMethod =
      [...methodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
    const notes = dunningByCustomer.get(customerId) ?? [];
    const promised = notes.filter((n) => n.status === "PROMISED").length;
    const lastInteraction = notes.reduce<Date | null>(
      (acc, n) => (!acc || n.lastContactAt > acc ? n.lastContactAt : acc),
      null
    );
    const judgedCount = onTime + late;
    return {
      customerId,
      customerName,
      totalContracts: contractCountMap.get(customerId) ?? 0,
      // 无付款历史时按中性 0.5, 避免落入"高信用温和"或"低信用强硬"任一极端话术
      paidOnTimeRate: judgedCount > 0 ? onTime / judgedCount : 0.5,
      avgPaymentDelay: late > 0 ? Math.round(totalDelayDays / late) : 0,
      preferredMethod,
      // 无催收记录时按 1 (不触发"响应率低需电话跟进"备注)
      responseRate: notes.length > 0 ? promised / notes.length : 1,
      lastInteraction
    };
  }

  const patterns = new Map<string, CustomerPaymentPattern>();
  const habits: PaymentHabit[] = [];
  for (const row of byContract.values()) {
    const pattern =
      patterns.get(row.customerId) ?? buildPattern(row.customerId, row.customerName);
    patterns.set(row.customerId, pattern);
    const pays = paymentsByCustomer.get(row.customerId) ?? [];
    const paymentDays = pays
      .filter((p) => p.invoice?.applyDate)
      .map((p) => Math.max(0, daysBetween(p.receivedAt, new Date(p.invoice!.applyDate!))));
    habits.push({
      contractId: row.contractId,
      contractNo: row.contractNo,
      customerId: row.customerId,
      customerName: row.customerName,
      totalContracts: pattern.totalContracts,
      paidOnTimeCount: Math.round(pattern.paidOnTimeRate * pays.length),
      latePaymentCount: pays.length - Math.round(pattern.paidOnTimeRate * pays.length),
      avgPaymentDays:
        paymentDays.length > 0
          ? Math.round(paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length)
          : 0,
      preferredPaymentMethod: pattern.preferredMethod,
      lastPaymentDate: pays.reduce<Date | null>(
        (acc, p) => (!acc || p.receivedAt > acc ? p.receivedAt : acc),
        null
      ),
      outstandingAmount: Math.round(row.remaining * 100) / 100,
      overdueDays: row.daysOverdue
    });
  }

  // 5) 规则引擎出建议 (内部已按 CRITICAL>HIGH>MEDIUM>LOW 排序), 截取后回拼 invoiceId 等展示字段
  const recommendations = generateSmartCollectionAdvice(habits, patterns).slice(0, MAX_RECOMMENDATIONS);
  const items: CollectionAdviceItem[] = recommendations.map((rec) => {
    const row = byContract.get(rec.contractId)!;
    return {
      ...rec,
      invoiceId: row.invoiceId,
      invoiceNo: row.invoiceNo,
      ownerName: row.ownerName
    };
  });

  return {
    items,
    totalOverdueContracts: byContract.size,
    totalOutstanding:
      Math.round([...byContract.values()].reduce((s, r) => s + r.remaining, 0) * 100) / 100,
    generatedAt: now.toISOString()
  };
}
