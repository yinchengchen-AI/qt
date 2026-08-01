// 消息归档:把已读超过 N 天的 inbox 消息搬到 MessageArchive 表(append-only)
// 减少 Message 主表体积,保留可追溯性
//
// 设计要点:
//   - 用 $transaction:copy rows → deleteMany,失败一并回滚
//   - 批量上限 1000 / 次,避免长时间锁表
//   - 默认 90 天,可由 env MESSAGE_ARCHIVE_AFTER_DAYS 覆盖
//   - 不动 readAt IS NULL 的消息(unread 不归档,避免"还没看的信突然没了"的体验问题)
//
// runner 调度:凌晨 03:00 UTC 后某次 hourly 触发(避开 02:00 备份、01:00 Vercel Cron)
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_AFTER_DAYS = Number(process.env.MESSAGE_ARCHIVE_AFTER_DAYS ?? 90);
const BATCH_SIZE = 1000;

type TxOrClient = Prisma.TransactionClient | PrismaClient;

export type MessageArchiveResult = {
  archived: number;
  batch: number;
  remaining: number;
  afterDays: number;
};

/**
 * 把 readAt != null 且 readAt < (now - afterDays) 的消息搬到 MessageArchive。
 * 调用方负责把它挂在 runAllJobs 里(类似 tickStaleContracts)。
 *
 * 失败抛错 — caller 在 $transaction 上下文里会回滚,不会半截。
 */
export async function runMessageArchive(
  now: Date = new Date(),
  txOrClient: TxOrClient = prisma
): Promise<MessageArchiveResult> {
  const afterDays = DEFAULT_AFTER_DAYS;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - afterDays);

  const candidates = await txOrClient.message.findMany({
    where: { readAt: { not: null, lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      receiverUserId: true,
      type: true,
      title: true,
      content: true,
      link: true,
      entityKey: true,
      readAt: true,
      createdAt: true
    }
  });

  if (candidates.length === 0) {
    return { archived: 0, batch: 0, remaining: 0, afterDays };
  }

  // $transaction:copy + deleteMany;Prisma 客户端的 $transaction 方法
  return (txOrClient as PrismaClient).$transaction(async (tx) => {
      await tx.messageArchive.createMany({
        data: candidates.map((m) => ({
          id: m.id,
          receiverUserId: m.receiverUserId,
          type: m.type,
          title: m.title,
          content: m.content,
          link: m.link === null ? undefined : (m.link as Prisma.InputJsonValue),
          entityKey: m.entityKey,
          readAt: m.readAt,
          createdAt: m.createdAt
        })),
        skipDuplicates: true
      });
      const ids = candidates.map((m) => m.id);
      const deleted = await tx.message.deleteMany({ where: { id: { in: ids } } });
      return {
        archived: deleted.count,
        batch: candidates.length,
        remaining: Math.max(0, candidates.length - deleted.count),
        afterDays
      } satisfies MessageArchiveResult;
    });
}
