// 定时任务统一入口：被 /api/jobs/run 路由调用
// 每个 job 接受 prisma + now，返回统计
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";

import { tickPublishableDraffts, tickCompletionCandidates } from "@/server/jobs/contract-automation";
import { runCertificateExpiryCheck } from "@/server/jobs/certificate-expiry-check";
import { tickStaleContracts } from "@/server/jobs/stale-contract";

/**
 * 单个 job 一次执行的统计。
 * - created:产生副作用的条数(发了几条消息/建了几个实例)
 * - scanned:扫描的候选数
 * - updated:就地更新的条数(如状态重算写库的);非所有 job 都有,允许 undefined
 */
export type JobResult = {
  job: string;
  created: number;
  scanned: number;
  updated?: number;
  durationMs: number;
  /** 失败时的错误信息；成功时不存在 */
  error?: string;
};

// cron 任务的去重查询都按 "今日 (type + entityId + receiverUserId)" 维度
// 返回的 entityId 集合供调用方在 JS 里做 O(1) 查表
const todayStart = (now: Date) => {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  return t;
};

export async function runAllJobs(now = new Date()): Promise<JobResult[]> {
  const admins = await prisma.user.findMany({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: { id: true }
  });
  const jobs = [
    { name: "contract-expiring", run: () => contractExpiringJob(now, admins) },
    { name: "invoice-overdue", run: () => invoiceOverdueJob(now, admins) },
    { name: "contract-auto-publish", run: () => tickPublishableDraffts() },
    { name: "contract-auto-complete", run: () => tickCompletionCandidates(now) },
    { name: "contract-stale-notify", run: () => tickStaleContracts(now) },
    // P0-11: 证书到期检查,跟 01:00 通用入口打通,便于监控和手动触发
    {
      name: "certificate-expiry-check",
      run: async () => {
        const r = await runCertificateExpiryCheck(now);
        return {
          job: "certificate-expiry-check",
          created: r.sent,
          scanned: r.scanned,
          durationMs: 0
        };
      }
    }
  ] as const;
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    console.warn(`[runAllJobs] ${jobs[i]!.name} failed:`, reason);
    return { job: jobs[i]!.name, created: 0, scanned: 0, durationMs: 0, error: reason };
  });
}

// CONTRACT_EXPIRING: endDate - 30/7/1 天，每天扫一次
// 去重按 (type + entityId + receiverUserId + 今日),一次 findMany 拿所有"今天已发"的合同 owner 集合
export async function contractExpiringJob(now: Date, admins?: { id: string }[]): Promise<JobResult> {
  const t0 = Date.now();
  const targets = [30, 7, 1];
  const adminList = admins ?? await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false }, select: { id: true } });
  const adminIds = adminList.map((a) => a.id);
  const today = todayStart(now);

  let created = 0;
  let scanned = 0;
  for (const days of targets) {
    // 找 endDate 落在 (today + days) 这一整天的合同
    //   target = today 00:00 + days
    //   dayEnd = target + 1 day
    // 修复:P0-pre (review 时才发现) 之前 dayEnd 误算成 dayStart + 1,导致 30/7/1 三个窗口全部空,通知从未发出去
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const target = new Date(dayStart);
    target.setDate(target.getDate() + days);
    const dayEnd = new Date(target);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const candidates = await prisma.contract.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: target, lt: dayEnd }
      },
      select: { id: true, contractNo: true, endDate: true, ownerUserId: true }
    });
    scanned += candidates.length;
    if (candidates.length === 0) continue;

    // 一次 findMany 拿今天"该 type 涉及到的 owner"的所有消息,
    // 再在 JS 里按 (entityId, owner) 二元组做去重判断。
    // Prisma 的 JsonFilter 不支持 in 路径查询,所以走"拉全量 + JS 过滤"。
    // 每天每 type 的消息量是几十量级,这一步的代价远低于 N 次单查。
    const candidateIds = new Set(candidates.map((c) => c.id));
    const alreadySent = await prisma.message.findMany({
      where: {
        type: "CONTRACT_EXPIRING",
        receiverUserId: { in: candidates.map((c) => c.ownerUserId) },
        createdAt: { gte: today }
      },
      select: { receiverUserId: true, link: true }
    });
    const sentSet = new Set(
      alreadySent
        .map((m) => {
          const link = m.link as { id?: string } | null;
          return link?.id && candidateIds.has(link.id) ? `${link.id}:${m.receiverUserId}` : null;
        })
        .filter((k): k is string => k !== null)
    );

    for (const c of candidates) {
      if (sentSet.has(`${c.id}:${c.ownerUserId}`)) continue;
      await emit(prisma, {
        type: "CONTRACT_EXPIRING",
        payload: { contractId: c.id, contractNo: c.contractNo, endDate: c.endDate, daysLeft: days },
        receivers: Array.from(new Set([c.ownerUserId, ...adminIds]))
      });
      created++;
    }
  }
  return { job: "contract-expiring", created, scanned, durationMs: Date.now() - t0 };
}

// INVOICE_OVERDUE_PAYMENT: actualIssueDate + 30 天，未全额回款
// 去重按 (type + entityId + 今日),与 receiverUserId 无关 (一张发票可能同时通知 owner + 多 admin + 财务,
// 实体层面"今天已经发过"就跳过整次广播)
export async function invoiceOverdueJob(now: Date, admins?: { id: string }[]): Promise<JobResult> {
  const t0 = Date.now();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const today = todayStart(now);
  const adminList = admins ?? await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false }, select: { id: true } });
  const adminIds = adminList.map((a) => a.id);
  // finance 列表在循环外一次性拉,所有候选共享
  const finance = await prisma.user.findMany({ where: { role: { code: "FINANCE" }, deletedAt: null, status: "ACTIVE", isSystem: false }, select: { id: true } });
  const financeIds = finance.map((f) => f.id);

  const candidates = await prisma.invoice.findMany({
    where: {
      status: "ISSUED",
      deletedAt: null,
      actualIssueDate: { lte: cutoff }
    },
    include: {
      contract: { select: { ownerUserId: true } }
    }
  });
  const scanned = candidates.length;
  if (candidates.length === 0) {
    return { job: "invoice-overdue", created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  // 一次 groupBy 拿所有候选发票的"已确认回款"合计
  const invoiceIds = candidates.map((inv) => inv.id);
  const paidAgg = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoiceIds }, status: { in: ["CONFIRMED", "RECONCILED"] } },
    _sum: { amount: true }
  });
  const paidByInvoice = new Map(
    paidAgg.map((p) => [p.invoiceId, Number(p._sum.amount ?? 0)])
  );

  // 一次 findMany 拿今天所有 INVOICE_OVERDUE_PAYMENT 消息,再 JS 里按 link.id 过滤
  // (Prisma JsonFilter 不支持路径 in,改用"拉全量 + JS 过滤")
  const candidateInvoiceIds = new Set(invoiceIds);
  const alreadySent = await prisma.message.findMany({
    where: { type: "INVOICE_OVERDUE_PAYMENT", createdAt: { gte: today } },
    select: { link: true }
  });
  const sentInvoiceIds = new Set(
    alreadySent
      .map((m) => (m.link as { id?: string } | null)?.id)
      .filter((id): id is string => !!id && candidateInvoiceIds.has(id))
  );

  let created = 0;
  for (const inv of candidates) {
    if (sentInvoiceIds.has(inv.id)) continue;
    const paid = paidByInvoice.get(inv.id) ?? 0;
    const remaining = Number(inv.amount) - paid;
    if (remaining <= 0.01) continue;
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.actualIssueDate!).getTime()) / 86400_000);
    await emit(prisma, {
      type: "INVOICE_OVERDUE_PAYMENT",
      payload: { invoiceId: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customerName, daysOverdue, remaining: remaining.toFixed(2) },
      receivers: Array.from(new Set([inv.contract.ownerUserId, ...adminIds, ...financeIds]))
    });
    created++;
  }
  return { job: "invoice-overdue", created, scanned, durationMs: Date.now() - t0 };
}
