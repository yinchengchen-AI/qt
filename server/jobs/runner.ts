// 定时任务统一入口：被 /api/jobs/run 路由调用
// 每个 job 接受 prisma + now，返回统计
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";

export type JobResult = { job: string; created: number; scanned: number; durationMs: number };

export async function runAllJobs(now = new Date()): Promise<JobResult[]> {
  return Promise.all([
    contractExpiringJob(now),
    invoiceOverdueJob(now),
    projectDueJob(now),
    customerInactiveJob(now)
  ]);
}

// CONTRACT_EXPIRING: endDate - 30/7/1 天，每天扫一次
export async function contractExpiringJob(now: Date): Promise<JobResult> {
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
      const admins = await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" }, select: { id: true } });
      await emit(prisma, {
        type: "CONTRACT_EXPIRING",
        payload: { contractId: c.id, contractNo: c.contractNo, endDate: c.endDate, daysLeft: days },
        receivers: Array.from(new Set([c.ownerUserId, ...admins.map((a) => a.id)]))
      });
      created++;
    }
  }
  return { job: "contract-expiring", created, scanned, durationMs: Date.now() - t0 };
}

// INVOICE_OVERDUE_PAYMENT: actualIssueDate + 30 天，未全额回款
export async function invoiceOverdueJob(now: Date): Promise<JobResult> {
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
      project: { include: { contract: { select: { ownerUserId: true } } } }
    }
  });
  let created = 0;
  let scanned = candidates.length;
  for (const inv of candidates) {
    const sum = await prisma.payment.aggregate({
      where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] } },
      _sum: { amount: true }
    });
    const paid = Number(sum._sum.amount ?? 0);
    const remaining = Number(inv.amount) - paid;
    if (remaining <= 0.01) continue;
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.actualIssueDate!).getTime()) / 86400_000);
    const admins = await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" }, select: { id: true } });
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
      receivers: Array.from(new Set([inv.project.contract.ownerUserId, ...admins.map((a) => a.id), ...finance.map((f) => f.id)]))
    });
    created++;
  }
  return { job: "invoice-overdue", created, scanned, durationMs: Date.now() - t0 };
}

// PROJECT_DUE: endDate - 7 天
export async function projectDueJob(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const targetDay = new Date(dayStart);
  targetDay.setDate(targetDay.getDate() + 7);
  const dayEnd = new Date(targetDay);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const candidates = await prisma.project.findMany({
    where: {
      status: { in: ["IN_PROGRESS", "PLANNED"] },
      endDate: { gte: targetDay, lt: dayEnd }
    },
    include: { contract: { select: { contractNo: true, ownerUserId: true } } }
  });
  let created = 0;
  const scanned = candidates.length;
  for (const p of candidates) {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const exists = await prisma.message.findFirst({
      where: { type: "PROJECT_DUE", receiverUserId: p.managerUserId, createdAt: { gte: todayStart }, link: { path: ["id"], equals: p.id } }
    });
    if (exists) continue;
    const admins = await prisma.user.findMany({ where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" }, select: { id: true } });
    await emit(prisma, {
      type: "PROJECT_DUE",
      payload: { projectId: p.id, projectNo: p.projectNo, contractNo: p.contract.contractNo, daysLeft: 7 },
      receivers: Array.from(new Set([p.managerUserId, p.contract.ownerUserId, ...admins.map((a) => a.id)]))
    });
    created++;
  }
  return { job: "project-due", created, scanned, durationMs: Date.now() - t0 };
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
