import { prisma } from "@/lib/prisma";

/**
 * 应收账龄口径需要隔离的数据质量问题。
 * DUPLICATE_INVOICE_NO 只打标不隔离, 因此不在该列表里。
 */
export const DQ_AGING_EXCLUDED_CODES = [
  "PENDING_INVOICE_NO",
  "NO_INVOICE_REQUIRED",
  "INVALID_AGING_DATE",
] as const;

export type AgingExcludedIssueCode = (typeof DQ_AGING_EXCLUDED_CODES)[number];

/** 读取指定发票中仍处于 OPEN 且应隔离的问题, 返回 invoiceId -> issueCodes。 */
export async function getOpenAgingExcludedIssues(
  invoiceIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (invoiceIds.length === 0) return map;

  const rows = await prisma.invoiceDataQualityIssue.findMany({
    where: {
      invoiceId: { in: invoiceIds },
      status: "OPEN",
      issueCode: { in: [...DQ_AGING_EXCLUDED_CODES] }
    },
    select: { invoiceId: true, issueCode: true }
  });

  for (const row of rows) {
    const codes = map.get(row.invoiceId) ?? [];
    codes.push(row.issueCode);
    map.set(row.invoiceId, codes);
  }
  return map;
}

/** 判断某个 issueCode 是否应被账龄主口径隔离。 */
export function isAgingExcludedIssueCode(code: string): boolean {
  return (DQ_AGING_EXCLUDED_CODES as readonly string[]).includes(code);
}
