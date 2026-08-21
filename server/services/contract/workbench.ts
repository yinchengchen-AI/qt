// 个人合同工作台 service (Phase 1)
//
// 数据范围: "我的合同" = ownerUserId = 当前用户, 对所有角色一致 (SALES / EXPERT / FINANCE / ADMIN 都是个人视角).
// 口径对齐 spec §3.5 (docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md):
//   - 活跃合同数   = status = ACTIVE (含逾期窗口内的)
//   - 即将到期     = ACTIVE 且 endDate ∈ [now, now + 7d]
//   - 逾期合同     = ACTIVE 且 endDate < now (宽限期窗口内未被强关、也未双足额自动完结的)
//                   + CLOSED 且 reviewComment = "overdue_terminated" (已强关待善后)
//   - 风险预警     = 我的 ACTIVE 合同中风险等级 HIGH/CRITICAL 的数量 (Phase 2 实时计算)
//
// 安全: 所有查询的 ownerUserId 一律从 session 取, 不接受客户端传入; 只读操作不写审计日志.
import { prisma } from "@/lib/prisma";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";
import { computeContractRisks, RISK_LEVEL_ORDER, type ContractRisk } from "@/server/services/contract/risk-score";
import { buildRiskReport } from "@/server/services/contract/risk-report";
import {
  computeEnhancedRiskScore,
  type EnhancedRiskScoreInput,
  type EnhancedRiskScoreResult
} from "@/server/services/contract/risk-score-enhanced";
import { env } from "@/lib/env";

const DAY_MS = 86_400_000;
/** 即将到期窗口 (天), 与 spec §3.5 的 0-7 天一致 */
const EXPIRING_WINDOW_DAYS = 7;
/** 生效多久无已开票发票才算 "未开票" 待办 (天), 与 Phase 3 超期未开票口径同源 */
const NO_INVOICE_GRACE_DAYS = 30;

/** getMyStats 需要的 ACTIVE 合同字段 (risk 批量算分复用) */
const ACTIVE_RISK_SELECT = {
  id: true,
  contractNo: true,
  customerId: true,
  customerName: true,
  title: true,
  totalAmount: true,
  startDate: true,
  endDate: true,
  ownerUserId: true
} as const;

export type MyStats = {
  /** status = ACTIVE 的合同数 (含逾期窗口内的) */
  active: number;
  /** ACTIVE 且 endDate ∈ [now, now+7d] */
  expiringSoon: number;
  /** ACTIVE 且 endDate < now + CLOSED 且 reviewComment="overdue_terminated" */
  overdue: number;
  /** 我的 ACTIVE 合同中风险等级 HIGH/CRITICAL 的数量 (实时计算) */
  risk: number;
};

export async function getMyStats(user: SessionUser): Promise<MyStats> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);

  // 一次查询拿所有 ACTIVE 合同 (含 risk 算分需要的字段), 在 JS 里按 endDate 分桶 (避免 3 次 count / N+1)
  const [activeContracts, forceClosed] = await Promise.all([
    prisma.contract.findMany({
      where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
      select: ACTIVE_RISK_SELECT
    }),
    // 已强关待善后: 宽限期强关 (reason 存在 reviewComment) 的合同
    // 口径与 status.ts tryAutoCloseOnOverdue 一致; 统计区间内强关的按 endDate 窗口过滤
    prisma.contract.count({
      where: {
        ownerUserId: user.id,
        status: "CLOSED",
        reviewComment: "overdue_terminated",
        deletedAt: null,
        endDate: { gte: new Date(now.getTime() - 90 * DAY_MS) }
      }
    })
  ]);

  let expiringSoon = 0;
  let overdueActive = 0;
  for (const c of activeContracts) {
    if (!c.endDate) continue;
    if (c.endDate.getTime() < now.getTime()) overdueActive++;
    else if (c.endDate.getTime() <= in7Days.getTime()) expiringSoon++;
  }

  const risks = await computeContractRisks(activeContracts, now);
  const risk = risks.filter((r) => RISK_LEVEL_ORDER[r.level] >= RISK_LEVEL_ORDER.HIGH).length;

  return {
    active: activeContracts.length,
    expiringSoon,
    overdue: overdueActive + forceClosed,
    risk
  };
}

/** 我的 MEDIUM+ 风险合同 (实时计算, 按分数降序); 工作台风险抽屉列表数据源 */
export async function getMyRisks(user: SessionUser): Promise<ContractRisk[]> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const activeContracts = await prisma.contract.findMany({
    where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
    select: ACTIVE_RISK_SELECT
  });
  const risks = await computeContractRisks(activeContracts);
  return risks
    .filter((r) => RISK_LEVEL_ORDER[r.level] >= RISK_LEVEL_ORDER.MEDIUM)
    .sort((a, b) => b.score - a.score);
}

/** 单合同风险详情: 实时算分 + 近 30 天快照趋势 + 报告 (Phase 4a, spec §7.2) */
export type RiskTrendPoint = { date: Date; score: number; level: string };
export type ContractRiskDetail = ContractRisk & {
  trend: RiskTrendPoint[];
  recommendations: string[];
  /** Phase 4a: 加权公式串 / 趋势汇总 / 报告日期 (抽屉与详情页共用) */
  weightedScore: string;
  trendSummary: import("@/server/services/contract/risk-report").RiskTrendSummary | null;
  asOf: string;
};

export async function getContractRisk(user: SessionUser, contractId: string): Promise<ContractRiskDetail | null> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: ACTIVE_RISK_SELECT
  });
  if (!contract) return null;

  const [risk] = await computeContractRisks([contract]);
  if (!risk) return null;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 30);
  // 快照带 dimensions (trendSummary 的 mainDriver 需要比对各维度增量)
  const snapshots = await prisma.riskScoreSnapshot.findMany({
    where: { contractId, snapshotDate: { gte: since } },
    orderBy: { snapshotDate: "asc" },
    select: { snapshotDate: true, score: true, level: true, dimensions: true }
  });

  const report = buildRiskReport(risk, snapshots, env.CONTRACT_OVERDUE_GRACE_DAYS);
  return {
    ...risk,
    trend: snapshots.map((s) => ({ date: s.snapshotDate, score: s.score, level: s.level })),
    recommendations: report.recommendations,
    weightedScore: report.weightedScore,
    trendSummary: report.trendSummary,
    asOf: report.asOf
  };
}

/** Phase 5 增强风险详情: 在原五维度基础上加入行业、历史逾期、季节性三维度 */
export type ContractEnhancedRiskDetail = {
  contractId: string;
  contractNo: string;
  customerName: string;
  title: string;
  enhancedScore: number;
  enhancedLevel: string;
  dimensions: EnhancedRiskScoreResult["dimensions"];
  enhancedDetails: EnhancedRiskScoreResult["enhancedDetails"];
};

export async function getContractEnhancedRisk(
  user: SessionUser,
  contractId: string
): Promise<ContractEnhancedRiskDetail | null> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      ...ACTIVE_RISK_SELECT,
      customer: { select: { industry: true } }
    }
  });
  if (!contract) return null;

  const [risk] = await computeContractRisks([contract]);
  if (!risk) return null;

  // 客户历史数据：用于增强风险评分的客户信用与历史逾期维度
  const customerContracts = await prisma.contract.findMany({
    where: { customerId: contract.customerId, deletedAt: null },
    select: { status: true, reviewComment: true, endDate: true, totalAmount: true }
  });
  const forceClosed = customerContracts.filter(
    (c) => c.status === "CLOSED" && c.reviewComment === "overdue_terminated"
  );
  const totalOverdueDays = forceClosed.reduce(
    (sum, c) => sum + Math.max(0, Math.floor((Date.now() - c.endDate.getTime()) / DAY_MS)),
    0
  );
  const priced = customerContracts.filter((c) => Number(c.totalAmount) > 0).map((c) => Number(c.totalAmount));

  const enhancedInput: EnhancedRiskScoreInput = {
    now: new Date(),
    startDate: contract.startDate,
    endDate: contract.endDate,
    totalAmount: risk.totalAmount,
    paidAmount: risk.paidAmount,
    invoicedAmount: risk.invoicedAmount,
    customerTotalContracts: customerContracts.length,
    customerForceClosed: forceClosed.length,
    customerAmountMean: priced.length > 0 ? priced.reduce((a, b) => a + b, 0) / priced.length : null,
    customerPricedContracts: priced.length,
    customerIndustry: contract.customer?.industry ?? undefined,
    customerOverdueHistory: {
      totalContracts: customerContracts.length,
      overdueContracts: forceClosed.length,
      totalOverdueDays
    }
  };

  const enhanced = computeEnhancedRiskScore(enhancedInput);

  return {
    contractId: risk.contractId,
    contractNo: risk.contractNo,
    customerName: risk.customerName,
    title: risk.title,
    enhancedScore: enhanced.score,
    enhancedLevel: enhanced.level,
    dimensions: enhanced.dimensions,
    enhancedDetails: enhanced.enhancedDetails
  };
}

export type TodoItem = {
  id: string;
  contractId: string;
  contractNo: string;
  title: string;
  customerName: string | null;
  type: "overdue" | "expiring" | "no_invoice";
  /** 1 = 逾期 (最优先), 2 = 7 天内到期, 3 = 未开票 */
  priority: 1 | 2 | 3;
  dueLabel: string;
  href: string;
};

export async function getMyTodos(user: SessionUser): Promise<TodoItem[]> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
  const noInvoiceCutoff = new Date(now.getTime() - NO_INVOICE_GRACE_DAYS * DAY_MS);

  // 一次查询拿所有 ACTIVE 合同 + 客户名 + 已开票发票 (未开票判定用), 避免 N+1
  const contracts = await prisma.contract.findMany({
    where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      contractNo: true,
      title: true,
      endDate: true,
      startDate: true,
      customer: { select: { name: true } },
      // 已开票口径: 与 overview.ts / stale-contract.ts 一致 (ISSUED + RED_FLUSHED)
      invoices: {
        where: { deletedAt: null, status: { in: [...INVOICE_ISSUED_AMOUNT_STATUSES] } },
        select: { id: true }
      }
    }
  });

  // 已续签合同的 overdue/expiring 待办消失 (Phase 1.5 spec §4.4: 创建续签后该项不再出现)
  // 一次预取 renewal 集合, 禁 N+1
  const renewals = await prisma.contract.findMany({
    where: { renewedFromId: { in: contracts.map((c) => c.id) }, deletedAt: null },
    select: { renewedFromId: true }
  });
  const renewedSourceIds = new Set(renewals.map((r) => r.renewedFromId));

  const todos: TodoItem[] = [];

  for (const c of contracts) {
    const renewed = renewedSourceIds.has(c.id);
    // 逾期 (priority 1) — 逾期合同不重复产生其他类型待办
    if (!renewed && c.endDate && c.endDate.getTime() < now.getTime()) {
      const daysOverdue = Math.floor((now.getTime() - c.endDate.getTime()) / DAY_MS);
      todos.push({
        id: `overdue-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "overdue",
        priority: 1,
        dueLabel: `已逾期 ${daysOverdue} 天`,
        href: `/contracts/${c.id}`
      });
      continue;
    }

    // 7 天内到期 (priority 2)
    if (!renewed && c.endDate && c.endDate.getTime() <= in7Days.getTime()) {
      const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / DAY_MS);
      todos.push({
        id: `expiring-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "expiring",
        priority: 2,
        dueLabel: `${daysLeft} 天后到期`,
        href: `/contracts/${c.id}`
      });
    }

    // 生效 ≥ 30 天无已开票发票 (priority 3; 口径与 Phase 3 超期未开票对齐)
    if (c.startDate && c.startDate.getTime() <= noInvoiceCutoff.getTime() && c.invoices.length === 0) {
      const daysSinceStart = Math.floor((now.getTime() - c.startDate.getTime()) / DAY_MS);
      todos.push({
        id: `no-invoice-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "no_invoice",
        priority: 3,
        dueLabel: `生效 ${daysSinceStart} 天未开票`,
        href: `/contracts/${c.id}`
      });
    }
  }

  // 按优先级排序 (逾期 > 7 天内到期 > 未开票)
  todos.sort((a, b) => a.priority - b.priority);
  return todos;
}
