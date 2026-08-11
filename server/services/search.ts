// 全局搜索服务
// 跨实体搜索: Customer / Contract / Invoice / Payment
// 受 RBAC 权限过滤 + 行级隔离 (SALES/EXPERT)

import { prisma } from "@/lib/prisma";
import { ownerEq, ownerViaContract } from "@/lib/ownership";

import type { SessionUser } from "@/lib/session";
import type { Prisma } from "@prisma/client";

export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  /** 结果所属模块, 用于前端分组 */
  module: "customer" | "contract" | "invoice" | "payment";
  /** 跳转路径 */
  link: string;
};

export type SearchResponse = {
  customers: SearchResult[];
  contracts: SearchResult[];
  invoices: SearchResult[];
  payments: SearchResult[];
};

/** 每个模块最多返回的结果数 */
const LIMIT_PER_MODULE = 10;

/**
 * 全局搜索入口
 * @param user 当前登录用户
 * @param keyword 搜索关键词 (至少 2 字符)
 */
export async function globalSearch(
  user: SessionUser,
  keyword: string
): Promise<SearchResponse> {
  const q = keyword.trim();
  if (q.length < 2) {
    return { customers: [], contracts: [], invoices: [], payments: [] };
  }

  // 并行搜索四个模块, 各自受 RBAC + RLS 约束
  const [customers, contracts, invoices, payments] = await Promise.all([
    searchCustomers(user, q),
    searchContracts(user, q),
    searchInvoices(user, q),
    searchPayments(user, q),
  ]);

  return { customers, contracts, invoices, payments };
}

/** 搜索客户: name, code, contactName, contactPhone */
async function searchCustomers(
  user: SessionUser,
  q: string
): Promise<SearchResult[]> {
  // SALES/EXPERT 只能搜自己负责的客户
  const rowFilter = ownerEq(user);

  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...rowFilter,
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { contactPhone: { contains: q, mode: "insensitive" } },
    ],
  };

  const rows = await prisma.customer.findMany({
    where,
    take: LIMIT_PER_MODULE,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      contactName: true,
      contactPhone: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    subtitle: [r.code, r.contactName].filter(Boolean).join(" · "),
    module: "customer" as const,
    link: `/customers/${r.id}`,
  }));
}

async function searchContracts(
  user: SessionUser,
  q: string
): Promise<SearchResult[]> {
  const rowFilter = ownerEq(user);

  const where: Prisma.ContractWhereInput = {
    deletedAt: null,
    ...rowFilter,
    OR: [
      { contractNo: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ],
  };

  const rows = await prisma.contract.findMany({
    where,
    take: LIMIT_PER_MODULE,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      contractNo: true,
      title: true,
      customerName: true,
      status: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: [r.contractNo, r.customerName].filter(Boolean).join(" · "),
    module: "contract" as const,
    link: `/contracts/${r.id}`,
  }));
}

/** 搜索发票: invoiceNo, invoiceCode, customerName */
async function searchInvoices(
  user: SessionUser,
  q: string
): Promise<SearchResult[]> {
  const rowFilter = ownerViaContract(user);

  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...rowFilter,
    OR: [
      { invoiceNo: { contains: q, mode: "insensitive" } },
      { invoiceCode: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ],
  };

  const rows = await prisma.invoice.findMany({
    where,
    take: LIMIT_PER_MODULE,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      invoiceNo: true,
      invoiceCode: true,
      customerName: true,
      status: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.invoiceNo,
    subtitle: [r.invoiceCode, r.customerName].filter(Boolean).join(" · "),
    module: "invoice" as const,
    link: `/invoices/${r.id}`,
  }));
}

async function searchPayments(
  user: SessionUser,
  q: string
): Promise<SearchResult[]> {
  const rowFilter = ownerViaContract(user);

  const where: Prisma.PaymentWhereInput = {
    deletedAt: null,
    ...rowFilter,
    OR: [
      { paymentNo: { contains: q, mode: "insensitive" } },
      { bankRefNo: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" }, deletedAt: null } },
    ],
  };

  const rows = await prisma.payment.findMany({
    where,
    take: LIMIT_PER_MODULE,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      paymentNo: true,
      bankRefNo: true,
      customer: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.paymentNo,
    subtitle: [r.bankRefNo, r.customer.name].filter(Boolean).join(" · "),
    module: "payment" as const,
    link: `/payments/${r.id}`,
  }));
}
