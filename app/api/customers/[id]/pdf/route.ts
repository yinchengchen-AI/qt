// 客户详情 → 打印页 HTML(供浏览器"另存为 PDF"使用)
// 字段来源 = lib/types/entities.ts 的 Customer + FollowUp 列表
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getCustomer, listFollowUps, listCustomerContracts } from "@/server/services/customer";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.EXPORT);
    const { id } = await params;
    const [c, followUps, contracts, owner] = await Promise.all([
      getCustomer(user, id),
      listFollowUps(user, id),
      listCustomerContracts(user, id),
      // 负责人姓名
      (async () => {
        const u = await prisma.user.findUnique({ where: { id: (await getCustomer(user, id)).ownerUserId }, select: { name: true, employeeNo: true } });
        return u;
      })()
    ]);

    const doc: PrintDoc = {
      title: `客户档案 - ${c.name}`,
      subtitle: `客户编号 ${c.code} · 状态 ${c.status}`,
      mainRows: [
        { label: "客户编号", value: c.code },
        { label: "客户全称", value: c.name },
        { label: "简称", value: c.shortName },
        { label: "统一社会信用代码", value: c.unifiedSocialCreditCode },
        { label: "类型", value: c.customerType },
        { label: "行业", value: c.industry },
        { label: "客户来源", value: c.sourceChannel },
        { label: "状态", value: c.status },
        { label: "客户负责人", value: owner ? `${owner.name} (${owner.employeeNo})` : c.ownerUserId },
        { label: "联系人", value: [c.contactName, c.contactTitle].filter(Boolean).join(" · ") || "—" },
        { label: "联系电话", value: c.contactPhone },
        { label: "所在地区", value: [c.province, c.city].filter(Boolean).join(" / ") },
        { label: "详细地址", value: c.address },
        { label: "创建时间", value: new Date(c.createdAt).toLocaleString("zh-CN") }
      ],
      sections: [
        {
          title: "跟进记录",
          rows: followUps.length
            ? followUps.map((f, i) => ({
                label: `${i + 1}. ${new Date(f.followAt).toLocaleString("zh-CN")} · ${f.method}`,
                value: `${f.content}${f.result ? ` [结果: ${f.result}]` : ""}`
              }))
            : [{ label: "(无)", value: "" }]
        },
        {
          title: "关联合同",
          rows: contracts.length
            ? contracts.map((c2) => ({
                label: c2.contractNo,
                value: `${c2.title} · 签订日 ${new Date(c2.signDate).toLocaleDateString("zh-CN")} · 总额 ${Number(c2.totalAmount).toFixed(2)} · ${c2.status}`
              }))
            : [{ label: "(无)", value: "" }]
        }
      ]
    };
    return new Response(renderPrintHtml(doc), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return err(e);
  }
}
