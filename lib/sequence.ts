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

    // 强制行级隔离：用 SELECT FOR UPDATE 锁
    const rows = await tx.$queryRawUnsafe<Array<{ id: string; lastValue: number }>>(
      `SELECT id, "lastValue" FROM "Sequence" WHERE prefix = $1 AND year = $2 FOR UPDATE`,
      key,
      year
    );
    let next: number;
    if (rows.length === 0) {
      await tx.sequence.create({ data: { prefix: key, year, lastValue: 1 } });
      next = 1;
    } else {
      const r = rows[0]!;
      next = r.lastValue + 1;
      await tx.sequence.update({ where: { id: r.id }, data: { lastValue: next } });
    }
    const suffix = String(next).padStart(4, "0");
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
