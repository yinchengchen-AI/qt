// 每天清 DingtalkLoginCode 中过期且未消费的临时码
import { prisma } from "@/lib/prisma";

const BATCH_LIMIT = 1000;
const KEEP_DAYS = 1;

export type CleanResult = { deleted: number };

export async function runCleanExpiredDingtalkCodes(): Promise<CleanResult> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  const r = await prisma.dingtalkLoginCode.deleteMany({
    where: {
      status: { in: ["PENDING", "EXPIRED", "CANCELLED"] },
      expiresAt: { lt: cutoff },
    },
  });
  return { deleted: r.count };
}