// 客户概览 / 关联合同列表
//
// 历史: 这个文件原本叫 followup.ts, 同时承担"客户跟进"和"客户 360 概览"两件事.
// 2026-06: 跟进 (FollowUp) 功能下线, 跟进相关的 service (addFollowUp / listFollowUps /
// getFollowUpOverview / canSeeAllFollowUps 等) 全部删除, 剩余的 getCustomerOverview 与
// listCustomerContracts 继续服务:
//   - GET /api/customers/[id]/overview
//   - GET /api/customers/[id]/pdf
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

import { ownerEq, ownerViaContract } from "@/lib/ownership";

export async function listCustomerContracts(user: SessionUser, customerId: string) {
  // 行级隔离: 客户必须可见
  await prisma.customer.findFirstOrThrow({
    where: { id: customerId, deletedAt: null, ...ownerEq(user) }
  });
  return prisma.contract.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { signDate: "desc" }
  });
}

export type CustomerOverview = {
  contracts: Array<{
    id: string;
    contractNo: string;
    title: string;
    serviceType: string;
    status: string;
    signDate: string;
    startDate: string;
    endDate: string;
    totalAmount: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    amount: string;
    actualIssueDate: string | null;
    contractId: string;
    contractNo: string;
  }>;
  payments: Array<{
    id: string;
    paymentNo: string;
    status: string;
    amount: string;
    receiveDate: string;
    contractId: string;
    contractNo: string;
  }>;
  totals: {
    contractCount: number;
    invoiceCount: number;
    paymentCount: number;
    contractTotal: number; // 元
    invoicedTotal: number;
    paidTotal: number;
  };
};

export async function getCustomerOverview(
  user: SessionUser,
  customerId: string
): Promise<CustomerOverview> {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  // 1. 客户存在性 + 行级隔离
  const c = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null, ...ownerEq(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);

  // 2. 一次性查所有相关数据
  const contracts = await prisma.contract.findMany({
    where: { customerId, deletedAt: null, ...ownerEq(user) },
    orderBy: { signDate: "desc" }
  });
  const contractIds = contracts.map((c) => c.id);
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) },
      orderBy: { applyDate: "desc" }
    }),
    prisma.payment.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
      orderBy: { receivedAt: "desc" }
    })
  ]);
  // 合同号 map
  const contractNoMap = new Map(contracts.map((c) => [c.id, c.contractNo]));
  // 数字汇总(用 string 转为 number 累加,避开 Decimal 序列化问题)
  let contractTotal = 0;
  for (const ct of contracts) {
    contractTotal += Number(ct.totalAmount);
  }
  let invoicedTotal = 0;
  for (const inv of invoices) {
    invoicedTotal += Number(inv.amount);
  }
  let paidTotal = 0;
  for (const p of payments) {
    paidTotal += Number(p.amount);
  }
  return {
    contracts: contracts.map((c) => ({
      id: c.id,
      contractNo: c.contractNo,
      title: c.title,
      serviceType: c.serviceType,
      status: c.status,
      signDate: c.signDate.toISOString(),
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
      totalAmount: c.totalAmount.toString()
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      amount: i.amount.toString(),
      actualIssueDate: i.actualIssueDate ? i.actualIssueDate.toISOString() : null,
      contractId: i.contractId,
      contractNo: contractNoMap.get(i.contractId) ?? ""
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      status: p.status,
      amount: p.amount.toString(),
      receiveDate: p.receivedAt.toISOString(),
      contractId: p.contractId,
      contractNo: contractNoMap.get(p.contractId) ?? ""
    })),
    totals: {
      contractCount: contracts.length,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      contractTotal,
      invoicedTotal,
      paidTotal
    }
  };
}
