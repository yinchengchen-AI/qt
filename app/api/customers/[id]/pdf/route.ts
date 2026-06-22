// 客户详情 → 打印页 HTML(浏览器"另存为 PDF"使用)
// 字段来源 = lib/types/entities.ts 的 Customer + 关联合同/项目/开票/回款 + 跟进
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getCustomer,
  listFollowUps,
  getCustomerOverview,
} from "@/server/services/customer";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { ALLOWED_DICTIONARY_CATEGORIES } from "@/lib/dictionary-categories";
import { CUSTOMER_STATUS_MAP, CONTRACT_STATUS_MAP, INVOICE_STATUS_MAP, PAYMENT_STATUS_MAP } from "@/lib/enum-maps";

const fmtDate = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleDateString("zh-CN") : "—";
const fmtDateTime = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleString("zh-CN") : "—";
const fmtAmount = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : "¥" + Number(v).toFixed(2);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.EXPORT);
      const { id } = await params;
      const [c, dictItems, followUps, overview] = await Promise.all([
        getCustomer(user, id),
        prisma.dictionary.findMany({
          where: {
            category: { in: [...ALLOWED_DICTIONARY_CATEGORIES] },
            isActive: true,
          },
          select: { category: true, code: true, label: true },
        }),
        listFollowUps(user, id),
        getCustomerOverview(user, id),
      ]);
      const owner = await prisma.user.findUnique({
        where: { id: c.ownerUserId },
        select: { name: true, employeeNo: true },
      });

      const dict: Record<string, string> = { ...CUSTOMER_STATUS_MAP };
      for (const i of dictItems) dict[`${i.category}::${i.code}`] = i.label;
      const label = (cat: string, code?: string | null) =>
        code ? (dict[`${cat}::${code}`] ?? code) : "";

      const totals = overview.totals;
      const doc: PrintDoc = {
        title: `客户档案 - ${c.name}`,
        subtitle: `客户编号 ${c.code} · 状态 ${label("CUSTOMER_STATUS", c.status)}`,
        meta: [
          { label: "客户编号:", value: c.code },
          {
            label: "客户负责人:",
            value: owner ? `${owner.name}(${owner.employeeNo})` : "—",
          },
        ],
        mainRows: [
          { label: "客户全称", value: c.name },
          { label: "简称", value: c.shortName ?? "—" },
          {
            label: "统一社会信用代码",
            value: c.unifiedSocialCreditCode ?? "—",
          },
          {
            label: "类型",
            value: label("CUSTOMER_TYPE", c.customerType) || "—",
          },
          { label: "规模", value: label("CUSTOMER_SCALE", c.scale) || "—" },
          {
            label: "行业",
            value: label("CUSTOMER_INDUSTRY", c.industry) || "—",
          },
          {
            label: "客户来源",
            value: label("CUSTOMER_SOURCE", c.sourceChannel) || "—",
          },
          {
            label: "联系人 / 职务",
            value:
              [c.contactName, c.contactTitle].filter(Boolean).join(" · ") ||
              "—",
          },
          { label: "联系电话", value: c.contactPhone ?? "—" },
          {
            label: "所在地区",
            value:
              [c.province, c.city, c.district].filter(Boolean).join(" / ") ||
              "—",
          },
          { label: "详细地址", value: c.address ?? "—" },
          { label: "创建时间", value: fmtDateTime(c.createdAt) },
        ],
        summary: [
          {
            label: "合同数",
            value: String(totals.contractCount),
            tone: "primary",
          },
          {
            label: "合同总额",
            value: fmtAmount(totals.contractTotal),
            tone: "primary",
          },
          {
            label: "已开票",
            value: fmtAmount(totals.invoicedTotal),
            tone: "warning",
          },
          {
            label: "已回款",
            value: fmtAmount(totals.paidTotal),
            tone: "success",
          },
        ],
        sections: [
          {
            title: "关联合同",
            columns: ["合同号", "标题", "签订日", "总额", "状态"],
            rows: overview.contracts.map((c2) => ({
              合同号: c2.contractNo,
              标题: c2.title,
              签订日: fmtDate(c2.signDate),
              总额: fmtAmount(c2.totalAmount),
              状态: CONTRACT_STATUS_MAP[c2.status] ?? c2.status,
            })),
            emptyText: "暂无关联合同",
          },
          {
            title: "开票记录",
            columns: ["发票号", "合同号", "开票日", "金额", "状态"],
            rows: overview.invoices.map((i) => ({
              发票号: i.invoiceNo ?? "未开",
              合同号: i.contractNo,
              开票日: fmtDate(i.actualIssueDate),
              金额: fmtAmount(i.amount),
              状态: INVOICE_STATUS_MAP[i.status] ?? i.status,
            })),
            emptyText: "暂无开票记录",
          },
          {
            title: "回款记录",
            columns: ["回单号", "合同号", "到账日", "金额", "状态"],
            rows: overview.payments.map((p) => ({
              回单号: p.paymentNo,
              合同号: p.contractNo,
              到账日: fmtDate(p.receiveDate),
              金额: fmtAmount(p.amount),
              状态: PAYMENT_STATUS_MAP[p.status] ?? p.status,
            })),
            emptyText: "暂无回款记录",
          },
          {
            title: "跟进记录",
            rows: followUps.length
              ? followUps.map((f) => ({
                  label: `${fmtDateTime(f.followAt)} · ${f.method}${f.result ? " · 结果:" + f.result : ""}`,
                  value: f.content,
                }))
              : [],
            emptyText: "暂无跟进记录",
          },
        ],
      };
      return new Response(renderPrintHtml(doc), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return err(e);
    }
  });
}
