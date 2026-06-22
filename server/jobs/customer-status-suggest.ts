// 客户状态机联动建议: 不直接写状态, 仅发站内信
//
// 规则 (见 PLAN 客户状态机优化 §4):
//   建议 LOST: status ∈ {LEAD, NEGOTIATING, SIGNED} 且 90 天无 FollowUp 且 无 ACTIVE 合同
//   建议 FROZEN: status ∈ {NEGOTIATING, SIGNED} 且 所有合同 CLOSED ≥ 30 天 且 60 天无 FollowUp 且 无未对账回款
//
// 行为:
//   - 每客户每天最多 1 条 (与 customerInactiveJob 同款去重: type+entityId+今日)
//   - 只发建议不发直接写; "启用自动写" 是 v2 的话题
//   - 用户点击后跳 /customers/<id>?suggest=<status> 走完整 changeCustomerStatus 校验 + 审计
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";
import { getAllowedTransitions, isCustomerStatus } from "@/lib/customer-status-transitions";
import type { CustomerStatus } from "@/types/enums";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;
const INACTIVE_DAYS = 90; // 跟进空窗
const FROZEN_INACTIVE_DAYS = 60; // 冻结建议的更严空窗
const CLOSED_GRACE_DAYS = 30; // 合同 CLOSED 后观察期

type Candidate = {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  lastFollowAt: Date | null;
  hasActiveContract: boolean;
  allClosedOverGrace: boolean; // 所有合同 CLOSED ≥ CLOSED_GRACE_DAYS
  hasPlannedOrConfirmedPayment: boolean; // 有未对账回款
};

async function loadCandidates(now: Date): Promise<Candidate[]> {
  // SQL 预过滤: 60 天内无任何跟进 (FROZEN 规则需要 ≥60 天空窗).
  //   - Prisma 的 followUps: { none: { followAt: { gte: cutoff } } } 表示"没有任何 followUp.followAt >= cutoff"
  //   - 即"所有跟进 (如有) 都早于 cutoff, 或完全无跟进"
  // LOST 规则需要 ≥90 天, 由内存二次判定; 预过滤只是减少扫描量, 不会漏掉潜在候选.
  const sixtyDaysAgo = new Date(now.getTime() - FROZEN_INACTIVE_DAYS * DAY_MS);
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      status: { in: ["LEAD", "NEGOTIATING", "SIGNED"] },
      followUps: { none: { followAt: { gte: sixtyDaysAgo } } }
    },
    select: {
      id: true,
      name: true,
      status: true,
      ownerUserId: true,
      createdAt: true,
      followUps: { orderBy: { followAt: "desc" }, take: 1, select: { followAt: true } },
      contracts: {
        where: { deletedAt: null },
        select: { status: true, endDate: true }
      }
    }
  });
  const customerIds = customers.map((c) => c.id);
  // 拉所有客户的回款状态聚合
  const payments = await prisma.payment.findMany({
    where: {
      customerId: { in: customerIds },
      status: { in: ["PLANNED", "CONFIRMED"] },
      deletedAt: null
    },
    select: { customerId: true }
  });
  const paymentByCustomer = new Set(payments.map((p) => p.customerId));

  return customers.map((c) => {
    const lastFollowAt = c.followUps[0]?.followAt ?? c.createdAt;
    const hasActiveContract = c.contracts.some(
      (ct) => ct.status === "ACTIVE"
    );
    const allClosedOverGrace = c.contracts.length > 0 &&
      c.contracts.every((ct) => {
        if (ct.status !== "CLOSED") return false;
        if (!ct.endDate) return false;
        const ageDays = (now.getTime() - new Date(ct.endDate).getTime()) / DAY_MS;
        return ageDays >= CLOSED_GRACE_DAYS;
      });
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      ownerUserId: c.ownerUserId,
      lastFollowAt,
      hasActiveContract,
      allClosedOverGrace,
      hasPlannedOrConfirmedPayment: paymentByCustomer.has(c.id)
    };
  });
}

async function alreadySuggestedToday(
  customerId: string,
  ownerUserId: string,
  suggestedStatus: CustomerStatus,
  now: Date
): Promise<boolean> {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const exists = await prisma.message.findFirst({
    where: {
      type: "CUSTOMER_STATUS_SUGGEST",
      receiverUserId: ownerUserId,
      createdAt: { gte: todayStart },
      // Prisma JSON 路径查询: AND 两条 path/equals 分别匹配 id 与 suggest
      AND: [
        { link: { path: ["id"], equals: customerId } },
        { link: { path: ["suggest"], equals: suggestedStatus } }
      ]
    }
  });
  return exists !== null;
}

/**
 * 每天扫一次: 对满足规则的非终态客户, 发 CUSTOMER_STATUS_SUGGEST 站内信.
 * 同一客户同一种建议当日最多 1 条.
 */
export async function tickCustomerStatusSuggestions(now: Date = new Date()): Promise<JobResult> {
  const t0 = Date.now();
  const candidates = await loadCandidates(now);
  let created = 0;
  const scanned = candidates.length;
  for (const c of candidates) {
    if (!isCustomerStatus(c.status)) continue;
    const allowed = getAllowedTransitions(c.status);
    const lastFollowAgeDays = c.lastFollowAt
      ? (now.getTime() - new Date(c.lastFollowAt).getTime()) / DAY_MS
      : Number.POSITIVE_INFINITY;

    // 规则 1: 建议 LOST
    if (allowed.includes("LOST") && lastFollowAgeDays >= INACTIVE_DAYS && !c.hasActiveContract) {
      if (await alreadySuggestedToday(c.id, c.ownerUserId, "LOST", now)) continue;
      await emit(prisma, {
        type: "CUSTOMER_STATUS_SUGGEST",
        payload: {
          customerId: c.id,
          customerName: c.name,
          suggestedStatus: "LOST",
          suggestedStatusLabel: "已流失",
          reason: `已 ${Math.floor(lastFollowAgeDays)} 天无跟进, 且无活跃合同`
        },
        receivers: [c.ownerUserId]
      });
      created++;
    }

    // 规则 2: 建议 FROZEN (与规则 1 互不冲突, 一个客户可能同时满足, 各发一条)
    if (
      allowed.includes("FROZEN") &&
      lastFollowAgeDays >= FROZEN_INACTIVE_DAYS &&
      c.allClosedOverGrace &&
      !c.hasPlannedOrConfirmedPayment
    ) {
      if (await alreadySuggestedToday(c.id, c.ownerUserId, "FROZEN", now)) continue;
      await emit(prisma, {
        type: "CUSTOMER_STATUS_SUGGEST",
        payload: {
          customerId: c.id,
          customerName: c.name,
          suggestedStatus: "FROZEN",
          suggestedStatusLabel: "已冻结",
          reason: `所有合同已结清 ≥ ${CLOSED_GRACE_DAYS} 天, 已 ${Math.floor(lastFollowAgeDays)} 天无跟进, 且无未对账回款`
        },
        receivers: [c.ownerUserId]
      });
      created++;
    }
  }
  return { job: "customer-status-suggest", created, scanned, durationMs: Date.now() - t0 };
}
