// 消息回收站清理 job (v0.24.0)
//
// 把 deletedAt < (now - afterDays) 的消息从 Message 表永久 hard delete,
// 跳过 30 天软删窗口(由 env MESSAGE_RECYCLE_PURGE_DAYS 控制, 默认 30)。
//
// 设计要点：
//   - $transaction: 单批 atomic, 失败一并回滚, 不会半截
//   - 批量上限 1000 / 次, 避免长时间锁表
//   - 与 runMessageArchive 互不重叠(archive 跳过 deletedAt != null, 这里只看 deletedAt != null)
//
// runner 调度:03:00 hourly tick 内, 挂在 runMessageArchive 之后(同一 tick, 顺序最末)
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_AFTER_DAYS = Number(process.env.MESSAGE_RECYCLE_PURGE_DAYS ?? 30);
const BATCH_SIZE = 1000;

type TxOrClient = Prisma.TransactionClient | PrismaClient;

export type MessageRecyclePurgeResult = {
  purged: number;
  batch: number;
  remaining: number;
  afterDays: number;
};

/**
 * 硬删 deletedAt < (now - afterDays) 的回收站消息
 * 调用方负责把它挂在 runAllJobs 里
 */
export async function runMessageRecyclePurge(
  now: Date = new Date(),
  txOrClient: TxOrClient = prisma
): Promise<MessageRecyclePurgeResult> {
  const afterDays = DEFAULT_AFTER_DAYS;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - afterDays);

  // 找候选: 已被软删且超过阈值的消息
  const candidates = await txOrClient.message.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    orderBy: { deletedAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, type: true, receiverUserId: true, deletedAt: true }
  });

  if (candidates.length === 0) {
    return { purged: 0, batch: 0, remaining: 0, afterDays };
  }

  return (txOrClient as PrismaClient).$transaction(async (tx) => {
    const ids = candidates.map((m) => m.id);
    const result = await tx.message.deleteMany({ where: { id: { in: ids } } });
    return {
      purged: result.count,
      batch: candidates.length,
      remaining: Math.max(0, candidates.length - result.count),
      afterDays
    } satisfies MessageRecyclePurgeResult;
  });
}
