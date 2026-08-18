// 合同风险评分每日快照 (Phase 2)
//
// 职责:
//   1) 对全部 ACTIVE 合同批量算分 (computeContractRisks, 预聚合无 N+1)
//   2) upsert 今日 RiskScoreSnapshot (@@unique([contractId, snapshotDate]) 幂等)
//   3) 与昨日快照比对: 等级上调且新等级为 HIGH/CRITICAL → 发 RISK_LEVEL_UP 给 owner + admin
//      entityKey = RISK_LEVEL_UP:{contractId}:{level}:{yyyy-MM-dd} (同日同档去重;
//      降档再升档会重发, 属真实恶化, 有意为之 — spec §12)
//   4) 完成后给全部 admin 发一条当日汇总 (HIGH/CRITICAL 计数), entityKey 带 SUMMARY 按日去重
//
// 挂入 runAllJobs, cron 每日跑。实时查询以现算为准, 快照只供趋势与升档 (spec §5.4)。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { emit, listAdminUserIds } from "@/server/events/bus";
import { computeContractRisks, RISK_LEVEL_ORDER, type RiskLevel } from "@/server/services/contract/risk-score";
import type { JobResult } from "./runner";

function dayStart(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runRiskScoreSnapshot(now = new Date()): Promise<JobResult> {
  const t0 = Date.now();
  const today = dayStart(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      contractNo: true,
      customerId: true,
      customerName: true,
      title: true,
      totalAmount: true,
      startDate: true,
      endDate: true,
      ownerUserId: true
    }
  });
  const scanned = contracts.length;
  if (scanned === 0) {
    return { job: "risk-score-snapshot", created: 0, scanned: 0, updated: 0, durationMs: Date.now() - t0 };
  }

  const risks = await computeContractRisks(contracts, now);

  // 幂等 upsert 今日快照
  // P2003 (FK 违规) 容忍跳过: findMany 到 upsert 之间合同被硬删 (测试并发清理/人工 DB 操作)
  // 不应让整个 job 失败; 软删合同不在扫描范围内, 生产正常路径不会触发
  let upserted = 0;
  for (const r of risks) {
    try {
      await prisma.riskScoreSnapshot.upsert({
        where: { contractId_snapshotDate: { contractId: r.contractId, snapshotDate: today } },
        create: {
          contractId: r.contractId,
          score: r.score,
          level: r.level,
          dimensions: r.dimensions,
          snapshotDate: today
        },
        update: { score: r.score, level: r.level, dimensions: r.dimensions }
      });
      upserted++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") continue;
      throw e;
    }
  }

  // 昨日快照比对 (一次 findMany, JS Map 查表)
  const yesterdaySnapshots = await prisma.riskScoreSnapshot.findMany({
    where: { contractId: { in: risks.map((r) => r.contractId) }, snapshotDate: yesterday },
    select: { contractId: true, level: true, score: true }
  });
  const prevByContract = new Map(yesterdaySnapshots.map((s) => [s.contractId, s]));

  const admins = await listAdminUserIds(prisma);
  let created = 0;
  for (const r of risks) {
    if (RISK_LEVEL_ORDER[r.level] < RISK_LEVEL_ORDER.HIGH) continue;
    const prev = prevByContract.get(r.contractId);
    const prevOrder = prev ? RISK_LEVEL_ORDER[prev.level as RiskLevel] : -1;
    if (prevOrder >= RISK_LEVEL_ORDER[r.level]) continue;
    // P2003 容忍: 并发测试清理会硬删 owner 用户/合同 (生产全软删, 正常路径不触发)
    try {
      await emit(prisma, {
        type: "RISK_LEVEL_UP",
        payload: {
          contractId: r.contractId,
          contractNo: r.contractNo,
          level: r.level,
          score: r.score,
          prevLevel: prev?.level ?? null,
          prevScore: prev?.score ?? null
        },
        entityKey: `RISK_LEVEL_UP:${r.contractId}:${r.level}:${isoDate(today)}`,
        receivers: Array.from(new Set([r.ownerUserId, ...admins]))
      });
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") continue;
      throw e;
    }
  }

  // admin 当日汇总 (有 HIGH/CRITICAL 才发)
  const high = risks.filter((r) => r.level === "HIGH").length;
  const critical = risks.filter((r) => r.level === "CRITICAL").length;
  if (high + critical > 0 && admins.length > 0) {
    const top = risks.reduce((a, b) => (b.score > a.score ? b : a));
    await emit(prisma, {
      type: "RISK_LEVEL_UP",
      payload: { summary: true, high, critical, topContractNo: top.contractNo, topScore: top.score },
      entityKey: `RISK_LEVEL_UP:SUMMARY:${isoDate(today)}`,
      receivers: admins
    });
    created++;
  }

  return { job: "risk-score-snapshot", created, scanned, updated: upserted, durationMs: Date.now() - t0 };
}
