// 合同详情 → 打印页 HTML
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getContract } from "@/server/services/contract";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";

const PAYMENT_METHOD_MAP: Record<string, string> = {
  LUMP_SUM: "一次性", BY_PHASE: "按阶段", BY_MONTH: "按月", BY_QUARTER: "按季"
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.EXPORT);
    const { id } = await params;
    const c = await getContract(user, id);
    const [owner, reviewer, projects] = await Promise.all([
      prisma.user.findUnique({ where: { id: c.ownerUserId }, select: { name: true, employeeNo: true } }),
      c.reviewerId ? prisma.user.findUnique({ where: { id: c.reviewerId }, select: { name: true, employeeNo: true } }) : null,
      prisma.project.findMany({ where: { contractId: c.id, deletedAt: null }, select: { projectNo: true, name: true, status: true } })
    ]);

    const doc: PrintDoc = {
      title: `合同 - ${c.contractNo}`,
      subtitle: `${c.title} · 客户: ${c.customerName}`,
      mainRows: [
        { label: "合同号", value: c.contractNo },
        { label: "合同标题", value: c.title },
        { label: "客户", value: c.customerName },
        { label: "服务类型", value: c.serviceType },
        { label: "签订日", value: new Date(c.signDate).toLocaleDateString("zh-CN") },
        { label: "服务起期", value: new Date(c.startDate).toLocaleDateString("zh-CN") },
        { label: "服务止期", value: new Date(c.endDate).toLocaleDateString("zh-CN") },
        { label: "含税总额", value: Number(c.totalAmount).toFixed(2) },
        { label: "税率", value: (Number(c.taxRate) * 100).toFixed(2) + "%" },
        { label: "税额", value: Number(c.taxAmount).toFixed(2) },
        { label: "不含税金额", value: Number(c.amountExcludingTax).toFixed(2) },
        { label: "付款方式", value: PAYMENT_METHOD_MAP[c.paymentMethod] ?? c.paymentMethod },
        { label: "业务员", value: owner ? `${owner.name} (${owner.employeeNo})` : c.ownerUserId },
        { label: "状态", value: c.status },
        { label: "审批人", value: reviewer ? `${reviewer.name} (${reviewer.employeeNo})` : (c.reviewerId ?? "—") },
        { label: "审批时间", value: c.reviewAt ? new Date(c.reviewAt).toLocaleString("zh-CN") : "—" },
        { label: "审批意见", value: c.reviewComment ?? "—" }
      ],
      sections: [
        {
          title: "拆分项目",
          rows: projects.length
            ? projects.map((p) => ({ label: p.projectNo, value: `${p.name} · ${p.status}` }))
            : [{ label: "(无)", value: "" }]
        }
      ]
    };
    return new Response(renderPrintHtml(doc), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return err(e);
  }
}
