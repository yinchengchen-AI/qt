// 客户状态机联动建议: 不直接写状态, 仅发站内信
//
// 规则 (见 PLAN 客户状态机优化 §4, follow-up 功能已下线后改用 lastActivityAt 信号):
//   建议 LOST: status ∈ {LEAD, NEGOTIATING, SIGNED} 且 90 天无活动 且 无 ACTIVE 合同
//   建议 FROZEN: status ∈ {NEGOTIATING, SIGNED} 且 所有合同 CLOSED ≥ 30 天 且 60 天无活动 且 无未对账回款
//
// lastActivityAt = max(
//   contract.signDate,
//   contract.endDate(where status=CLOSED),
//   payment.receivedAt(where status ∈ {PLANNED, CONFIRMED, RECONCILED}),
//   customer.updatedAt,
//   customer.createdAt
// )
//
// 行为:
//   - 每客户每天最多 1 条 (type+suggest+entityId+今日)
//   - 只发建议不发直接写; "启用自动写" 是 v2 的话题
//   - 用户点击后跳 /customers/<id>?suggest=<status> 走完整 changeCustomerStatus 校验 + 审计
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";
import { getAllowedTransitions, isCustomerStatus } from "@/lib/customer-status-transitions";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;
const INACTIVE_DAYS = 90; // 活动空窗 (LOST)
const FROZEN_INACTIVE_DAYS = 60; // 活动空窗 (FROZEN, 更严)
const CLOSED_GRACE_DAYS = 30; // 合同 CLOSED 后观察期

type Candidate = {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  lastActivityAt: Date; // 最后活动时间
  hasActiveContract: boolean;
  allClosedOverGrace: boolean; // 所有合同 CLOSED ≥ CLOSED_GRACE_DAYS
  hasPlannedOrConfirmedPayment: boolean; // 有未对账回款
};

async function loadCandidates(now: Date): Promise<Candidate[]> {
  // 不做 SQL 预过滤, 加载所有非终态客户, 在 JS 里算 lastActivityAt.
  // 数据量级: 非终态客户通常几百到几千, 每天跑一次, 性能可接受.
  // (原 followUps 预过滤因 follow-up 功能下线已删除)
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      status: { in: ["LEAD", "NEGOTIATING", "SIGNED"] }
    },
    select: {
      id: true,
      name: true,
      status: true,
      ownerUserId: true,
      createdAt: true,
      updatedAt: true,
      contracts: {
        where: { deletedAt: null },
        select: { signDate: true, endDate: true, status: true }
      }
    }
  });
  const customerIds = customers.map((c) => c.id);
  // 拉所有客户的活跃回款 (PLANNED/CONFIRMED/RECONCILED):
  //   - hasPlannedOrConfirmedPayment 只看 PLANNED/CONFIRMED
  //   - lastActivityAt 看三者的 receivedAt
  const payments = await prisma.payment.findMany({
    where: {
      customerId: { in: customerIds },
      status: { in: ["PLANNED", "CONFIRMED", "RECONCILED"] },
      deletedAt: null
    },
    select: { customerId: true, receivedAt: true, status: true }
  });
  // 按客户聚合: 最大 receivedAt + 是否含 PLANNED/CONFIRMED
  const aggByCustomer = new Map<string, { maxReceivedAt: number; hasPlannedOrConfirmed: boolean }>();
  for (const p of payments) {
    const t = p.receivedAt.getTime();
    const cur = aggByCustomer.get(p.customerId);
    if (!cur) {
      aggByCustomer.set(p.customerId, {
        maxReceivedAt: t,
        hasPlannedOrConfirmed: p.status === "PLANNED" || p.status === "CONFIRMED"
      });
    } else {
      cur.maxReceivedAt = Math.max(cur.maxReceivedAt, t);
      if (p.status === "PLANNED" || p.status === "CONFIRMED") cur.hasPlannedOrConfirmed = true;
    }
  }

  return customers.map((c) => {
    // 算 lastActivityAt
    const times: number[] = [c.createdAt.getTime(), c.updatedAt.getTime()];
    for (const ct of c.contracts) {
      times.push(ct.signDate.getTime());
      if (ct.status === "CLOSED" && ct.endDate) times.push(ct.endDate.getTime());
    }
    const agg = aggByCustomer.get(c.id);
    if (agg) times.push(agg.maxReceivedAt);
    const lastActivityAt = new Date(Math.max(...times));

    const hasActiveContract = c.contracts.some((ct) => ct.status === "ACTIVE");
    const allClosedOverGrace = c.contracts.length > 0 &&
      c.contracts.every((ct) => {
        if (ct.status !== "CLOSED") return false;
        if (!ct.endDate) return false;
        const ageDays = (now.getTime() - ct.endDate.getTime()) / DAY_MS;
        return ageDays >= CLOSED_GRACE_DAYS;
      });
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      ownerUserId: c.ownerUserId,
      lastActivityAt,
      hasActiveContract,
      allClosedOverGrace,
      hasPlannedOrConfirmedPayment: agg?.hasPlannedOrConfirmed ?? false
    };
  });
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
  // 批量化去重:一次 findMany 拉今天所有 CUSTOMER_STATUS_SUGGEST 消息,
  // 在 JS 里按 `${customerId}:${suggest}` 二元组查表(代替 N 次 findFirst)
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const candidateIds = new Set(candidates.map((c) => c.id));
  const ownerIds = Array.from(new Set(candidates.map((c) => c.ownerUserId)));
  const alreadySent = await prisma.message.findMany({
    where: {
      type: "CUSTOMER_STATUS_SUGGEST",
      receiverUserId: { in: ownerIds },
      createdAt: { gte: todayStart }
    },
    select: { link: true }
  });
  const sentKey = new Set(
    alreadySent
      .map((m) => {
        const link = m.link as { id?: string; suggest?: string } | null;
        if (!link?.id || !link.suggest || !candidateIds.has(link.id)) return null;
        return `${link.id}:${link.suggest}`;
      })
      .filter((k): k is string => k !== null)
  );

  for (const c of candidates) {
    if (!isCustomerStatus(c.status)) continue;
    const allowed = getAllowedTransitions(c.status);
    const lastActivityAgeDays = (now.getTime() - c.lastActivityAt.getTime()) / DAY_MS;

    // 规则 1: 建议 LOST
    if (allowed.includes("LOST") && lastActivityAgeDays >= INACTIVE_DAYS && !c.hasActiveContract) {
      if (sentKey.has(`${c.id}:LOST`)) continue;
      await emit(prisma, {
        type: "CUSTOMER_STATUS_SUGGEST",
        payload: {
          customerId: c.id,
          customerName: c.name,
          suggestedStatus: "LOST",
          suggestedStatusLabel: "已流失",
          reason: `已 ${Math.floor(lastActivityAgeDays)} 天无活动 (无合同/回款/资料更新), 且无活跃合同`
        },
        receivers: [c.ownerUserId]
      });
      created++;
    }

    // 规则 2: 建议 FROZEN (与规则 1 互不冲突, 一个客户可能同时满足, 各发一条)
    if (
      allowed.includes("FROZEN") &&
      lastActivityAgeDays >= FROZEN_INACTIVE_DAYS &&
      c.allClosedOverGrace &&
      !c.hasPlannedOrConfirmedPayment
    ) {
      if (sentKey.has(`${c.id}:FROZEN`)) continue;
      await emit(prisma, {
        type: "CUSTOMER_STATUS_SUGGEST",
        payload: {
          customerId: c.id,
          customerName: c.name,
          suggestedStatus: "FROZEN",
          suggestedStatusLabel: "已冻结",
          reason: `所有合同已结清 ≥ ${CLOSED_GRACE_DAYS} 天, 已 ${Math.floor(lastActivityAgeDays)} 天无活动, 且无未对账回款`
        },
        receivers: [c.ownerUserId]
      });
      created++;
    }
  }
  return { job: "customer-status-suggest", created, scanned, durationMs: Date.now() - t0 };
}
