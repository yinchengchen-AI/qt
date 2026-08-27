// 全局搜索聚合: 跨 客户/合同/发票/回款 四类实体, 各取前 5 条 + 命中总数。
// 逐组消费现有 READ 权限 (运行时权限真源, 见 lib/permissions.ts): 无权限的组返回空分组且不查库;
// 读路径开放 (read-open): 与列表页同口径, SALES/EXPERT 可跨 owner 搜索 (v0.18.4 Wave 3 权限改造);
// 软删除记录一律排除 (deletedAt: null)。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ACTION, RESOURCE, hasPermission } from "@/lib/permissions";
import {
  parseNaturalLanguageQuery,
  extractResidualKeyword,
  toSearchParams
} from "@/server/services/natural-language-search";

const GROUP_TAKE = 5;
// 短于 2 字符不查库: 单字符在中文场景几乎无区分度, 且 ILIKE 全表扫代价高
const MIN_KEYWORD_LENGTH = 2;

/** PostgreSQL LIKE 默认转义符是反斜杠; 转义 \ % _ 防止用户输入被当作通配符 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export type SearchGroup<T> = { total: number; items: T[] };

export type CustomerHit = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  contactName: string | null;
  contactPhone: string;
};
export type ContractHit = { id: string; contractNo: string; title: string; customerName: string; status: string };
export type InvoiceHit = { id: string; invoiceNo: string; customerName: string; amount: string; status: string };
export type PaymentHit = { id: string; paymentNo: string; customerName: string; amount: string; status: string };

export type SearchResult = {
  q: string;
  customers: SearchGroup<CustomerHit>;
  contracts: SearchGroup<ContractHit>;
  invoices: SearchGroup<InvoiceHit>;
  payments: SearchGroup<PaymentHit>;
  /** 自然语言结构化条件命中时的回显 (供前端展示 "已识别: 本月 · 大额 · 合同") */
  nl?: {
    timeLabel?: string;
    amountLabel?: string;
    category?: "customer" | "contract" | "invoice" | "payment";
    status?: string[];
    keyword?: string;
  };
};

const emptyResult = (q: string): SearchResult => ({
  q,
  customers: { total: 0, items: [] },
  contracts: { total: 0, items: [] },
  invoices: { total: 0, items: [] },
  payments: { total: 0, items: [] }
});

export type NlEcho = NonNullable<SearchResult["nl"]>;

export type NlPlan = {
  wheres: {
    customer?: Prisma.CustomerWhereInput;
    contract?: Prisma.ContractWhereInput;
    invoice?: Prisma.InvoiceWhereInput;
    payment?: Prisma.PaymentWhereInput;
  };
  echo: NlEcho;
};

/**
 * 自然语言检索计划 (纯函数, 不触库):
 * 解析出 时间/金额/状态 任一结构化条件时, 生成各类别 where + 回显; 否则返回 null 走纯关键词路径。
 * 关键词用残余关键词 (extractResidualKeyword), 且经 escapeLike 转义 (Prisma contains→ILIKE 不转义通配符)。
 * 状态词的值域是合同状态 (ACTIVE/CLOSED/DRAFT), 套到发票/回款状态域必空集 → 对这两类剥离。
 */
export function buildNlPlan(q: string): NlPlan | null {
  const parsed = parseNaturalLanguageQuery(q);
  const hasStructured = Boolean(
    parsed.timeRange || parsed.amountRange || (parsed.status && parsed.status.length > 0)
  );
  if (!hasStructured) return null;

  const residual = extractResidualKeyword(q);
  const keyword = residual.length >= MIN_KEYWORD_LENGTH ? residual : undefined;
  const parsedForWhere = { ...parsed, keywords: keyword ? [escapeLike(keyword)] : [] };
  const categories = (parsed.category
    ? [parsed.category]
    : ["customer", "contract", "invoice", "payment"]) as Array<"customer" | "contract" | "invoice" | "payment">;

  const wheres: NlPlan["wheres"] = {};
  for (const cat of categories) {
    const { where } = toSearchParams({ ...parsedForWhere, category: cat });
    if (cat === "invoice" || cat === "payment") delete where.status;
    const merged = { deletedAt: null, ...where };
    if (cat === "customer") wheres.customer = merged as Prisma.CustomerWhereInput;
    else if (cat === "contract") wheres.contract = merged as Prisma.ContractWhereInput;
    else if (cat === "invoice") wheres.invoice = merged as Prisma.InvoiceWhereInput;
    else wheres.payment = merged as Prisma.PaymentWhereInput;
  }

  return {
    wheres,
    echo: {
      timeLabel: parsed.timeRange?.label,
      amountLabel: parsed.amountRange?.label,
      category: parsed.category,
      status: parsed.status,
      keyword
    }
  };
}

export async function searchAll(user: SessionUser, q: string): Promise<SearchResult> {
  const keyword = q.trim().slice(0, 50);
  if (keyword.length < MIN_KEYWORD_LENGTH) return emptyResult(keyword);
  const kw = escapeLike(keyword);
  const like = { contains: kw, mode: "insensitive" as const };

  // 自然语言结构化条件命中时, 各类别 where 由 NL 计划给出; 未纳入计划的组跳过 (保持空分组)
  const nl = buildNlPlan(keyword);

  // read-open: 不注入 ownerEq / ownerViaContract, 与列表页读口径一致 (lib/ownership.ts 注释:
  // "此后仅统计/工作台/回收站口径使用; 业务浏览读路径不再消费")
  const customerWhere: Prisma.CustomerWhereInput = nl?.wheres.customer ?? {
    deletedAt: null,
    OR: [
      { code: like },
      { name: like },
      { shortName: like },
      { unifiedSocialCreditCode: like },
      { contactName: like },
      { contactPhone: like }
    ]
  };
  const contractWhere: Prisma.ContractWhereInput = nl?.wheres.contract ?? {
    deletedAt: null,
    OR: [{ contractNo: like }, { title: like }, { customerName: like }]
  };
  const invoiceWhere: Prisma.InvoiceWhereInput = nl?.wheres.invoice ?? {
    deletedAt: null,
    OR: [{ invoiceNo: like }, { invoiceCode: like }, { customerName: like }]
  };
  const paymentWhere: Prisma.PaymentWhereInput = nl?.wheres.payment ?? {
    deletedAt: null,
    OR: [{ paymentNo: like }, { bankRefNo: like }, { customer: { name: like } }]
  };

  // 逐组鉴权: 角色被 admin 在 /admin/roles 收窄后, 无 READ 权限的组返回空分组且不查库
  // (对齐列表页 requirePermission 口径; Promise.resolve 占位模式同 contract/crud.ts 的 countTotal 条件)
  // NL 模式下未纳入计划的组同样不查库
  const canCustomer = hasPermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ) && (!nl || nl.wheres.customer !== undefined);
  const canContract = hasPermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ) && (!nl || nl.wheres.contract !== undefined);
  const canInvoice = hasPermission(user.roleCode, RESOURCE.INVOICE, ACTION.READ) && (!nl || nl.wheres.invoice !== undefined);
  const canPayment = hasPermission(user.roleCode, RESOURCE.PAYMENT, ACTION.READ) && (!nl || nl.wheres.payment !== undefined);

  const [customers, customerTotal, contracts, contractTotal, invoices, invoiceTotal, payments, paymentTotal] =
    await Promise.all([
      canCustomer
        ? prisma.customer.findMany({
            where: customerWhere,
            orderBy: { updatedAt: "desc" },
            take: GROUP_TAKE,
            select: { id: true, code: true, name: true, shortName: true, contactName: true, contactPhone: true }
          })
        : Promise.resolve([]),
      canCustomer ? prisma.customer.count({ where: customerWhere }) : Promise.resolve(0),
      canContract
        ? prisma.contract.findMany({
            where: contractWhere,
            orderBy: { updatedAt: "desc" },
            take: GROUP_TAKE,
            select: { id: true, contractNo: true, title: true, customerName: true, status: true }
          })
        : Promise.resolve([]),
      canContract ? prisma.contract.count({ where: contractWhere }) : Promise.resolve(0),
      canInvoice
        ? prisma.invoice.findMany({
            where: invoiceWhere,
            orderBy: { updatedAt: "desc" },
            take: GROUP_TAKE,
            select: { id: true, invoiceNo: true, customerName: true, amount: true, status: true }
          })
        : Promise.resolve([]),
      canInvoice ? prisma.invoice.count({ where: invoiceWhere }) : Promise.resolve(0),
      canPayment
        ? prisma.payment.findMany({
            where: paymentWhere,
            orderBy: { updatedAt: "desc" },
            take: GROUP_TAKE,
            select: {
              id: true,
              paymentNo: true,
              amount: true,
              status: true,
              customer: { select: { name: true } }
            }
          })
        : Promise.resolve([]),
      canPayment ? prisma.payment.count({ where: paymentWhere }) : Promise.resolve(0)
    ]);

  return {
    q: keyword,
    customers: { total: customerTotal, items: customers },
    contracts: { total: contractTotal, items: contracts },
    invoices: {
      total: invoiceTotal,
      items: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        customerName: inv.customerName,
        amount: inv.amount.toString(),
        status: inv.status
      }))
    },
    payments: {
      total: paymentTotal,
      items: payments.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        customerName: p.customer.name,
        amount: p.amount.toString(),
        status: p.status
      }))
    },
    ...(nl ? { nl: nl.echo } : {})
  };
}
