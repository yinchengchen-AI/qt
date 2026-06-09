// 业务编号：QT-{类型简码}-YYYY-####，年内递增，Sequence 表 + 事务内 UPSERT
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { ERROR_CODES } from "@/types/errors";

const PREFIX_MAP = {
  CUSTOMER: "QT-C",      // QT-C-YYYYMM-#### 月度
  CONTRACT: "QT-HT",     // QT-HT-YYYY-####
  PROJECT: "QT-P",       // QT-P-YYYY-####
  PAYMENT: "QT-PAY"      // QT-PAY-YYYY-####
} as const;
type SeqType = keyof typeof PREFIX_MAP;

export async function nextBusinessNo(type: SeqType, opts?: { yyyymm?: boolean }): Promise<string> {
  const prefix = PREFIX_MAP[type];
  const year = new Date().getFullYear();

  return prisma.$transaction(async (tx) => {
    // 客户编号按月：QT-C-YYYYMM
    const key = opts?.yyyymm
      ? `${prefix}-${year}${String(new Date().getMonth() + 1).padStart(2, "0")}`
      : `${prefix}-${year}`;

    // 1) 原子 upsert + 自增：(prefix, year) 不存在则 lastValue=1，存在则 lastValue=lastValue+1
    // 用 prisma.upsert 保证行存在（解决 SELECT FOR UPDATE 看到 0 行的竞态）
    // 再用 PG 原生 RETURNING 拿最新值
    const upserted = await tx.sequence.upsert({
      where: { prefix_year: { prefix: key, year } },
      update: {},
      create: { prefix: key, year, lastValue: 0 }
    });
    // 2) 原子自增 + 返回新值（用 SQL RETURNING）
    const rows = await tx.$queryRawUnsafe<Array<{ lastValue: number }>>(
      `UPDATE "Sequence" SET "lastValue" = "lastValue" + 1, "updatedAt" = NOW()
       WHERE id = $1 RETURNING "lastValue"`,
      upserted.id
    );
    const r = rows[0]!;
    const suffix = String(r.lastValue).padStart(4, "0");
    return `${key}-${suffix}`;
  });
}

// 直接读取当年进度（用于展示/调试）
export async function peekSequence(type: SeqType): Promise<number> {
  const prefix = PREFIX_MAP[type];
  const year = new Date().getFullYear();
  const r = await prisma.sequence.findUnique({ where: { prefix_year: { prefix: `${prefix}-${year}`, year } } });
  return r?.lastValue ?? 0;
}
