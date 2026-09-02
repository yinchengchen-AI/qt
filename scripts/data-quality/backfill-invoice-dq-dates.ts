#!/usr/bin/env tsx
/**
 * 应收账龄异常日期回填。
 *
 * 只处理当前 OPEN INVALID_AGING_DATE 且日期早于 2000-01-01 的 ISSUED 发票。
 * 数据源为旧 FineUI 导出 CSV, 按 invoiceNo 的迁移顺序精确匹配,
 * 金额不一致或源日期缺失时跳过, 避免误改。
 *
 * 用法:
 *   npx tsx scripts/data-quality/backfill-invoice-dq-dates.ts --dry-run
 *   npx tsx scripts/data-quality/backfill-invoice-dq-dates.ts --apply
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const CUTOFF = new Date("2000-01-01T00:00:00.000Z");
const CSV_PATH = path.resolve("ops/legacy/csv/invoices.csv");

type LegacyInvoice = {
  id: string;
  invoiceNo: string;
  amount: number;
  invoiceDate: string;
};

function parseDateToShanghai(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const normalized = (text.includes("T") ? text : text.replace(" ", "T"))
    .replace(/\.(\d{3})\d*/, ".$1");
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseCsv(): LegacyInvoice[] {
  const raw = readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0]!.split("\t").map((s) => s.trim());
  const idIdx = header.indexOf("ID");
  const noIdx = header.indexOf("InvoiceNo");
  const amountIdx = header.indexOf("InvoiceAmount");
  const dateIdx = header.indexOf("InvoiceDate");
  if ([idIdx, noIdx, amountIdx, dateIdx].some((i) => i < 0)) {
    throw new Error("legacy invoices.csv 缺少预期列");
  }

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return {
      id: cols[idIdx]!.trim(),
      invoiceNo: cols[noIdx]?.trim() ?? "",
      amount: Number(cols[amountIdx] ?? 0) || 0,
      invoiceDate: cols[dateIdx]?.trim() ?? ""
    };
  });
}

function stripDupSuffix(invoiceNo: string): { base: string; index: number } {
  const m = invoiceNo.match(/^(.*)-DUP(\d+)$/);
  if (!m) return { base: invoiceNo, index: 0 };
  return { base: m[1]!, index: Number(m[2]!) };
}

function resolveSource(
  current: { invoiceNo: string; amount: number },
  byBase: Map<string, LegacyInvoice[]>
): LegacyInvoice | null {
  const { base, index } = stripDupSuffix(current.invoiceNo);
  const rows = (byBase.get(base) ?? []).sort((a, b) => Number(a.id) - Number(b.id));
  const candidate = rows[index];
  if (!candidate) return null;
  if (Math.abs(candidate.amount - current.amount) > 0.01) return null;
  return candidate;
}

async function main() {
  const legacyRows = parseCsv();
  const byBase = new Map<string, LegacyInvoice[]>();
  for (const row of legacyRows) {
    const list = byBase.get(row.invoiceNo) ?? [];
    list.push(row);
    byBase.set(row.invoiceNo, list);
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: null,
      status: "ISSUED",
      OR: [
        { actualIssueDate: { lt: CUTOFF } },
        { dueDate: { lt: CUTOFF } }
      ]
    },
    select: {
      id: true,
      invoiceNo: true,
      amount: true,
      actualIssueDate: true,
      dueDate: true
    }
  });

  const issues = await prisma.invoiceDataQualityIssue.findMany({
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      issueCode: "INVALID_AGING_DATE",
      status: "OPEN"
    },
    select: { invoiceId: true, id: true }
  });
  const issueIdByInvoice = new Map(issues.map((i) => [i.invoiceId, i.id]));

  let matched = 0;
  let skipped = 0;
  let updated = 0;
  const samples: string[] = [];

  for (const inv of invoices) {
    const source = resolveSource({ invoiceNo: inv.invoiceNo, amount: Number(inv.amount) }, byBase);
    if (!source) {
      skipped += 1;
      continue;
    }
    const actualIssueDate = parseDateToShanghai(source.invoiceDate);
    if (!actualIssueDate || actualIssueDate >= CUTOFF) {
      skipped += 1;
      continue;
    }
    const dueDate = new Date(actualIssueDate.getTime() + 30 * 86400_000);
    matched += 1;
    if (samples.length < 12) {
      samples.push(
        `${inv.invoiceNo}\t${source.invoiceDate}\t${inv.actualIssueDate?.toISOString() ?? "-"}\t${actualIssueDate.toISOString()}`
      );
    }

    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { actualIssueDate, dueDate }
      });
      const issueId = issueIdByInvoice.get(inv.id);
      if (issueId) {
        await prisma.invoiceDataQualityIssue.update({
          where: { id: issueId },
          data: { status: "RESOLVED", resolvedAt: new Date() }
        });
      }
      updated += 1;
    }
  }

  console.log(
    `[backfill-invoice-dq-dates] mode=${APPLY ? "apply" : "dry-run"} candidates=${invoices.length} matched=${matched} skipped=${skipped} updated=${updated}`
  );
  for (const sample of samples) {
    console.log(`[SAMPLE]\t${sample}`);
  }

  if (DRY_RUN && !APPLY) {
    console.log("\n确认无误后运行: npx tsx scripts/data-quality/backfill-invoice-dq-dates.ts --apply");
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
