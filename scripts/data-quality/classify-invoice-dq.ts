#!/usr/bin/env tsx
/**
 * 应收账龄发票数据质量分类/打标脚本。
 *
 * 规则:
 *   - PENDING_INVOICE_NO:  发票号以 0000000 开头(旧系统占位)。
 *   - NO_INVOICE_REQUIRED: remark 明确"不需要发票/不开票"等。
 *   - INVALID_AGING_DATE:  actualIssueDate 或 dueDate 早于 2000-01-01。
 *   - DUPLICATE_INVOICE_NO: 发票号含 -DUP 或 remark 含"发票号重复"。
 *
 * 用法:
 *   npx tsx scripts/data-quality/classify-invoice-dq.ts --dry-run
 *   npx tsx scripts/data-quality/classify-invoice-dq.ts --apply
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const OLD_DATE = new Date("2000-01-01T00:00:00.000Z");

type IssueCode =
  | "PENDING_INVOICE_NO"
  | "NO_INVOICE_REQUIRED"
  | "INVALID_AGING_DATE"
  | "DUPLICATE_INVOICE_NO";

function classify(inv: {
  id: string;
  invoiceNo: string;
  remark: string | null;
  actualIssueDate: Date | null;
  dueDate: Date | null;
}): Array<{ code: IssueCode; detail: string }> {
  const issues: Array<{ code: IssueCode; detail: string }> = [];

  if (inv.invoiceNo.startsWith("0000000")) {
    issues.push({
      code: "PENDING_INVOICE_NO",
      detail: `invoiceNo=${inv.invoiceNo}`
    });
  }

  const remark = inv.remark ?? "";
  if (
    /不需要发票|不需要开票|不开票|不开发票|不用发票|对私不开发票|自己开开/.test(remark)
  ) {
    issues.push({
      code: "NO_INVOICE_REQUIRED",
      detail: remark.trim() || "客户不需要发票"
    });
  }

  if (
    (inv.actualIssueDate && inv.actualIssueDate < OLD_DATE) ||
    (inv.dueDate && inv.dueDate < OLD_DATE)
  ) {
    issues.push({
      code: "INVALID_AGING_DATE",
      detail: `actualIssueDate=${inv.actualIssueDate?.toISOString() ?? "-"}; dueDate=${inv.dueDate?.toISOString() ?? "-"}`
    });
  }

  if (/-DUP\d*$/.test(inv.invoiceNo) || remark.includes("发票号重复")) {
    issues.push({
      code: "DUPLICATE_INVOICE_NO",
      detail: `invoiceNo=${inv.invoiceNo}`
    });
  }

  return issues;
}

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: "ISSUED" },
    select: {
      id: true,
      invoiceNo: true,
      remark: true,
      actualIssueDate: true,
      dueDate: true,
      amount: true
    }
  });

  const summary = new Map<string, { count: number; amount: number }>();
  let upserted = 0;

  for (const inv of invoices) {
    const issues = classify(inv);
    for (const issue of issues) {
      const existing = summary.get(issue.code) ?? { count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += Number(inv.amount);
      summary.set(issue.code, existing);

      if (APPLY) {
        await prisma.invoiceDataQualityIssue.upsert({
          where: {
            invoiceId_issueCode: {
              invoiceId: inv.id,
              issueCode: issue.code
            }
          },
          update: { detail: issue.detail },
          create: {
            invoiceId: inv.id,
            issueCode: issue.code,
            detail: issue.detail,
            status: "OPEN"
          }
        });
        upserted += 1;
      }
    }
  }

  console.log(
    `[classify-invoice-dq] mode=${APPLY ? "apply" : "dry-run"} invoices=${invoices.length} issueRows=${DRY_RUN ? summary.size : upserted}`
  );
  for (const [code, stat] of [...summary.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(
      `[${code}] count=${stat.count} amount=${stat.amount.toFixed(2)}`
    );
  }

  if (DRY_RUN && !APPLY) {
    console.log("\n确认无误后运行: npx tsx scripts/data-quality/classify-invoice-dq.ts --apply");
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
