
// 回款详情 → 打印页 HTML
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { METHOD_MAP, PAYMENT_STATUS_MAP } from "@/lib/enum-maps";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getPayment } from "@/server/services/payment";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { formatDateTime } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.EXPORT);
      const { id } = await params;
      const p = await getPayment(user, id);
      const [recorder, reconciler] = await Promise.all([
        prisma.user.findUnique({
          where: { id: p.recorderUserId },
          select: { name: true, employeeNo: true },
        }),
        p.reconcileUserId
          ? prisma.user.findUnique({
              where: { id: p.reconcileUserId },
              select: { name: true, employeeNo: true },
            })
          : null,
      ]);

      const doc: PrintDoc = {
        title: `回款 - ${p.paymentNo}`,
        subtitle: `金额 ¥${Number(p.amount).toFixed(2)} · 状态 ${PAYMENT_STATUS_MAP[p.status] ?? p.status}`,
        mainRows: [
          { label: "回款号", value: p.paymentNo },
          { label: "金额", value: Number(p.amount).toFixed(2) },
          { label: "收款方式", value: METHOD_MAP[p.method] ?? p.method },
          {
            label: "到账日",
            value: formatDateTime(p.receivedAt),
          },
          { label: "银行流水号", value: p.bankRefNo ?? "—" },
          { label: "收款行", value: p.bankName ?? "—" },
          { label: "关联发票号", value: p.invoice?.invoiceNo ?? "—" },
          { label: "状态", value: PAYMENT_STATUS_MAP[p.status] ?? p.status },
          {
            label: "登记人",
            value: recorder
              ? `${recorder.name} (${recorder.employeeNo})`
              : p.recorderUserId,
          },
          {
            label: "对账人",
            value: reconciler
              ? `${reconciler.name} (${reconciler.employeeNo})`
              : "—",
          },
          {
            label: "对账时间",
            value: p.reconciledAt
              ? formatDateTime(p.reconciledAt)
              : "—",
          },
          { label: "备注", value: p.remark ?? "—" },
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
