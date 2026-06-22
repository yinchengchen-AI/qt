// 定时任务统一入口：被 /api/jobs/run 路由调用
// 每个 job 接受 prisma + now，返回统计
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";

import { runAssetExpiryJob } from "@/server/services/asset-expiry-job";
import { runContractExpiryJob } from "@/server/services/contract";
export { runContractExpiryJob };

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
};

export async function runAllJobs(now = new Date()): Promise<JobResult[]> {
  const admins = await prisma.user.findMany({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: { id: true }
  });
  return Promise.all([
    contractExpiringJob(now, admins),
    invoiceOverdueJob(now, admins),
    customerInactiveJob(now),
    runAssetExpiryJob(now, admins),
    runContractExpiryJob(now)
  ]);
}

// CONTRACT_EXPIRING: endDate - 30/7/1 天，每天扫一次
export async function contractExpiringJob(now: Date, admins?: { id: string }[]): Promise<JobResult> {
  const t0 = Date.now();
  const targets = [30, 7, 1];
  let created = 0;
  let scanned = 0;
  for (const days of targets) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const target = new Date(dayStart);
    target.setDate(target.getDate() + days);
    const candidates = await prisma.contract.findMany({
      where: {
        status: { in: ["EFFECTIVE", "EXECUTING"] },
        endDate: { gte: target, lt: dayEnd }
      },
      select: { id: true, contractNo: true, endDate: true, ownerUserId: true }
    });
    scanned += candidates.length;
    for (const c of candidates) {
      // 防重复：今天是否已发过同 daysLeft 提醒（按 type + entityId + 当天）
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const exists = await prisma.message.findFirst({
        where: {
          type: "CONTRACT_EXPIRING",
          receiverUserId: c.ownerUserId,
          createdAt: { gte: todayStart },
          link: { path: ["id"], equals: c.id }
        }
      });
      if (exists) continue;
      const adminList = admins ?? await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false }, select: { id: true } });
      await emit(prisma, {
        type: "CONTRACT_EXPIRING",
        payload: { contractId: c.id, contractNo: c.contractNo, endDate: c.endDate, daysLeft: days },
        receivers: Array.from(new Set([c.ownerUserId, ...adminList.map((a) => a.id)]))
      });
      created++;
    }
  }
  return { job: "contract-expiring", created, scanned, durationMs: Date.now() - t0 };
}

// INVOICE_OVERDUE_PAYMENT: actualIssueDate + 30 天，未全额回款
export async function invoiceOverdueJob(now: Date, admins?: { id: string }[]): Promise<JobResult> {
  const t0 = Date.now();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
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
  let created = 0;
  const scanned = candidates.length;
  for (const inv of candidates) {
    const sum = await prisma.payment.aggregate({
      where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] } },
      _sum: { amount: true }
    });
    const paid = Number(sum._sum.amount ?? 0);
    const remaining = Number(inv.amount) - paid;
    if (remaining <= 0.01) continue;
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.actualIssueDate!).getTime()) / 86400_000);
    const adminList = admins ?? await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false }, select: { id: true } });
    // 找财务
    const finance = await prisma.user.findMany({ where: { role: { code: "FINANCE" }, deletedAt: null, status: "ACTIVE" }, select: { id: true } });
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const exists = await prisma.message.findFirst({
      where: { type: "INVOICE_OVERDUE_PAYMENT", createdAt: { gte: todayStart }, link: { path: ["id"], equals: inv.id } }
    });
    if (exists) continue;
    await emit(prisma, {
      type: "INVOICE_OVERDUE_PAYMENT",
      payload: { invoiceId: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customerName, daysOverdue, remaining: remaining.toFixed(2) },
      receivers: Array.from(new Set([inv.contract.ownerUserId, ...adminList.map((a) => a.id), ...finance.map((f) => f.id)]))
    });
    created++;
  }
  return { job: "invoice-overdue", created, scanned, durationMs: Date.now() - t0 };
}

// CUSTOMER_INACTIVE: 90 天无 FollowUp
export async function customerInactiveJob(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 90);
  // 找出 ownerUserId 拥有的所有客户最近跟进时间
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, status: { not: "FROZEN" } },
    include: { followUps: { orderBy: { followAt: "desc" }, take: 1 } }
  });
  let created = 0;
  const scanned = customers.length;
  for (const c of customers) {
    const last = c.followUps[0]?.followAt ?? c.createdAt;
    if (new Date(last) >= cutoff) continue;
    const daysInactive = Math.floor((now.getTime() - new Date(last).getTime()) / 86400_000);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const exists = await prisma.message.findFirst({
      where: { type: "CUSTOMER_INACTIVE", receiverUserId: c.ownerUserId, createdAt: { gte: todayStart }, link: { path: ["id"], equals: c.id } }
    });
    if (exists) continue;
    await emit(prisma, {
      type: "CUSTOMER_INACTIVE",
      payload: { customerId: c.id, customerName: c.name, daysInactive },
      receivers: [c.ownerUserId]
    });
    created++;
  }
  return { job: "customer-inactive", created, scanned, durationMs: Date.now() - t0 };
}

