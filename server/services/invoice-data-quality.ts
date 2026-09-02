// 应收账龄/发票数据质量统计分析
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ownerViaContract } from "@/lib/ownership";
import type { Prisma } from "@prisma/client";

export type InvoiceDataQualityQuery = {
  issueCode?: string;
  status?: "OPEN" | "RESOLVED";
  keyword?: string;
  page?: number;
  pageSize?: number;
};

export type InvoiceDataQualityItem = {
  id: string;
  issueCode: string;
  status: "OPEN" | "RESOLVED";
  detail: string | null;
  createdAt: string;
  resolvedAt: string | null;
  invoiceId: string;
  invoiceNo: string;
  customerName: string;
  contractNo: string | null;
  ownerName: string | null;
  amount: number;
  actualIssueDate: string | null;
  dueDate: string | null;
};

export type InvoiceDataQualitySummary = {
  openIssueCount: number;
  resolvedIssueCount: number;
  openInvoiceCount: number;
  openAmount: number;
};

function ownerIssueWhere(user: SessionUser): Prisma.InvoiceDataQualityIssueWhereInput {
  return {
    invoice: {
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
    }
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function parseList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export async function getInvoiceDataQualityIssues(
  user: SessionUser,
  query: InvoiceDataQualityQuery = {}
) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
  const where: Prisma.InvoiceDataQualityIssueWhereInput = ownerIssueWhere(user);

  const issueCodes = parseList(query.issueCode);
  if (issueCodes) where.issueCode = { in: issueCodes };
  if (query.status) where.status = query.status;
  if (query.keyword?.trim()) {
    const keyword = query.keyword.trim();
    where.OR = [
      { invoice: { invoiceNo: { contains: keyword, mode: "insensitive" } } },
      { invoice: { customerName: { contains: keyword, mode: "insensitive" } } },
      { invoice: { contract: { contractNo: { contains: keyword, mode: "insensitive" } } } },
      { issueCode: { contains: keyword, mode: "insensitive" } },
      { detail: { contains: keyword, mode: "insensitive" } }
    ];
  }

  const [rows, total, summaryRows] = await Promise.all([
    prisma.invoiceDataQualityIssue.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        issueCode: true,
        status: true,
        detail: true,
        createdAt: true,
        resolvedAt: true,
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            customerName: true,
            amount: true,
            actualIssueDate: true,
            dueDate: true,
            contract: {
              select: {
                contractNo: true,
                owner: { select: { name: true, employeeNo: true } }
              }
            }
          }
        }
      }
    }),
    prisma.invoiceDataQualityIssue.count({ where }),
    prisma.invoiceDataQualityIssue.findMany({
      where: ownerIssueWhere(user),
      select: {
        issueCode: true,
        status: true,
        invoiceId: true,
        invoice: { select: { amount: true } }
      }
    })
  ]);

  const list: InvoiceDataQualityItem[] = rows.map((r) => ({
    id: r.id,
    issueCode: r.issueCode,
    status: r.status as "OPEN" | "RESOLVED",
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    invoiceId: r.invoice.id,
    invoiceNo: r.invoice.invoiceNo,
    customerName: r.invoice.customerName,
    contractNo: r.invoice.contract?.contractNo ?? null,
    ownerName: r.invoice.contract?.owner?.name ?? null,
    amount: Number(r.invoice.amount),
    actualIssueDate: r.invoice.actualIssueDate?.toISOString() ?? null,
    dueDate: r.invoice.dueDate?.toISOString() ?? null
  }));

  let openIssueCount = 0;
  let resolvedIssueCount = 0;
  const openInvoiceIds = new Set<string>();
  let openAmount = 0;
  for (const s of summaryRows) {
    if (s.status === "OPEN") {
      openIssueCount += 1;
      openInvoiceIds.add(s.invoiceId);
    } else {
      resolvedIssueCount += 1;
    }
  }
  const openInvoiceAmount = new Map<string, number>();
  for (const s of summaryRows) {
    if (s.status !== "OPEN") continue;
    if (!openInvoiceAmount.has(s.invoiceId)) {
      openInvoiceAmount.set(s.invoiceId, Number(s.invoice.amount));
    }
  }
  for (const amount of openInvoiceAmount.values()) {
    openAmount = round2(openAmount + amount);
  }

  const summary: InvoiceDataQualitySummary = {
    openIssueCount,
    resolvedIssueCount,
    openInvoiceCount: openInvoiceIds.size,
    openAmount
  };

  return { list, total, summary };
}
