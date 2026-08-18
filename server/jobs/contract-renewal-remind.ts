// 合同到期未续签提醒 (Phase 1.5, spec §4.2)
//
// 判定: status = ACTIVE 且 endDate < now - 30 天 (到期超 30 天)
//       且不存在 renewedFromId = 该合同的有效合同 (未删除)
// 频率: entityKey 带 ISO 周 (yyyy-Www) → 同一合同同一周自然去重, 跨周可再发;
//       job 内部按"本周已发"第一道过滤 (与 stale-contract 同模式), skipDuplicates 兜底。
// 接收人: owner + admin (与现有合同类 job 一致)。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { emit, listAdminUserIds } from "@/server/events/bus";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;
/** 到期超过多少天才提醒续签 (spec §4.2) */
const RENEWAL_REMIND_AFTER_DAYS = 30;

/** ISO 周键 (yyyy-Www), 如 2026-W34; entityKey 按周去重的依据 */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO 周: 周四所在周为该年的第几周 (ISO-8601)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekStart(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  // 回到本周一 (ISO 周从周一开始)
  const day = t.getDay() || 7;
  t.setDate(t.getDate() - day + 1);
  return t;
}

export async function runContractRenewalRemind(now = new Date()): Promise<JobResult> {
  const t0 = Date.now();
  const cutoff = new Date(now.getTime() - RENEWAL_REMIND_AFTER_DAYS * DAY_MS);
  const thisWeekStart = weekStart(now);
  const weekKey = isoWeekKey(now);

  // 到期超 30 天仍 ACTIVE 的合同
  const candidates = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { lt: cutoff }, deletedAt: null },
    select: { id: true, contractNo: true, customerName: true, endDate: true, ownerUserId: true }
  });
  const scanned = candidates.length;
  if (scanned === 0) {
    return { job: "contract-renewal-remind", created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  const candidateIds = candidates.map((c) => c.id);
  // 一次查出已有有效续签合同的源合同集合 (禁 N+1)
  const renewals = await prisma.contract.findMany({
    where: { renewedFromId: { in: candidateIds }, deletedAt: null },
    select: { renewedFromId: true }
  });
  const renewedSourceIds = new Set(renewals.map((r) => r.renewedFromId));

  // 本周已发过滤: entityKey 前缀含周键, 直接字符串匹配 (createMany 唯一约束兜底)
  const alreadySent = await prisma.message.findMany({
    where: {
      type: "CONTRACT_RENEWAL_REMIND",
      createdAt: { gte: thisWeekStart },
      entityKey: { endsWith: weekKey }
    },
    select: { entityKey: true }
  });
  const sentThisWeek = new Set(alreadySent.map((m) => m.entityKey));

  const admins = await listAdminUserIds(prisma);
  let created = 0;
  for (const c of candidates) {
    if (renewedSourceIds.has(c.id)) continue;
    const entityKey = `CONTRACT_RENEWAL_REMIND:${c.id}:${weekKey}`;
    if (sentThisWeek.has(entityKey)) continue;
    const daysExpired = Math.floor((now.getTime() - c.endDate.getTime()) / DAY_MS);
    // P2003 容忍: 并发测试清理会硬删 owner 用户/合同 (生产全软删, 正常路径不触发)
    try {
      await emit(prisma, {
        type: "CONTRACT_RENEWAL_REMIND",
        payload: {
          contractId: c.id,
          contractNo: c.contractNo,
          customerName: c.customerName,
          endDate: c.endDate,
          daysExpired
        },
        entityKey,
        receivers: Array.from(new Set([c.ownerUserId, ...admins]))
      });
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") continue;
      throw e;
    }
  }
  return { job: "contract-renewal-remind", created, scanned, durationMs: Date.now() - t0 };
}
