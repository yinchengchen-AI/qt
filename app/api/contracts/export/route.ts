
// 合同列表导出 XLSX — 入参与 GET /api/contracts 对齐
import { exportFileTimestamp } from "@/lib/date-range";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listContracts } from "@/server/services/contract";
import { contractListQuerySchema } from "@/lib/validators/contract";
import { formatRegion } from "@/lib/region";
import { exportToXlsx, exportMaxRows, attachmentHeader } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import {
  serviceTypeLabel,
  PAYMENT_METHOD_MAP,
  CONTRACT_STATUS_MAP,
  BILLING_STATUS_MAP,
} from "@/lib/enum-maps";
import { formatDate } from "@/lib/format";

// 与列表共用一份筛选 schema, 防止两处漂移后导出静默丢条件 (zod 默认 strip 未知键).
// omit page/pageSize: 列表 schema 的分页默认值 (1/20) 会覆盖 exportMaxRows 兜底, 必须剥掉
const query = contractListQuerySchema.omit({ page: true, pageSize: true });

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.EXPORT);
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      // pageSize 用 exportMaxRows() 兜底, 防止单次导出 OOM; countTotal=false 跳过用不到的 count
      const { list } = await listContracts(user, {
        page: 1,
        pageSize: exportMaxRows(),
        countTotal: false,
        ...params,
      });
      // listContracts 已返回 invoicedAmount / paidAmount / billingStatus,直接复用
      const enriched = list;
      // 批量把 签订人 + 项目负责人 id 解析成姓名, 避免导出 N+1
      const userIdSet = new Set<string>();
      for (const c of list) {
        const sId = (c as { signerId?: string | null }).signerId;
        if (sId) userIdSet.add(sId);
        const oId = (c as { ownerUserId?: string | null }).ownerUserId;
        if (oId) userIdSet.add(oId);
      }
      const userIds = [...userIdSet];
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, employeeNo: true },
          })
        : [];
      const userById = new Map(users.map((u) => [u.id, u]));
      const ts = exportFileTimestamp();
      const buf = await exportToXlsx(
        enriched as unknown as Record<string, unknown>[],
        [
          { header: "合同号", key: "contractNo", width: 22 },
          { header: "客户", key: "customerName", width: 24 },
          {
            // 客户区域: listContracts 已拍平成 customerProvince/City/District/Town
            header: "客户区域",
            key: "customerProvince",
            width: 32,
            formatter: (_v, r) =>
              formatRegion(
                r.customerProvince as string | undefined,
                r.customerCity as string | undefined,
                r.customerDistrict as string | undefined,
                r.customerTown as string | undefined
              ),
          },
          { header: "合同标题", key: "title", width: 32 },
          {
            header: "服务类型",
            key: "serviceType",
            width: 14,
            formatter: (v) => serviceTypeLabel(v) || "",
          },
          {
            header: "签订人",
            key: "signerId",
            width: 14,
            formatter: (_v, r) => {
              const id = (r as { signerId?: string | null }).signerId;
              return id ? userById.get(id)?.name ?? "" : "";
            },
          },
          {
            header: "项目负责人",
            key: "ownerUserId",
            width: 14,
            formatter: (_v, r) => {
              const id = (r as { ownerUserId?: string | null }).ownerUserId;
              return id ? userById.get(id)?.name ?? "" : "";
            },
          },
          {
            header: "签订日",
            key: "signDate",
            width: 14,
            formatter: (v) =>
              v ? formatDate(v as string) : "",
          },
          {
            header: "服务起期",
            key: "startDate",
            width: 14,
            formatter: (v) =>
              v ? formatDate(v as string) : "",
          },
          {
            header: "服务止期",
            key: "endDate",
            width: 14,
            formatter: (v) =>
              v ? formatDate(v as string) : "",
          },
          {
            header: "含税总额",
            key: "totalAmount",
            width: 16,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "已开票金额",
            key: "invoicedAmount",
            width: 16,
            formatter: (v) => (v != null ? Number(v).toFixed(2) : ""),
          },
          {
            header: "已回款金额",
            key: "paidAmount",
            width: 16,
            formatter: (v) => (v != null ? Number(v).toFixed(2) : ""),
          },
          {
            header: "开票状态",
            key: "billingStatus",
            width: 12,
            formatter: (v) =>
              v ? (BILLING_STATUS_MAP[v as string] ?? (v as string)) : "",
          },
          {
            header: "税率",
            key: "taxRate",
            width: 10,
            formatter: (v) =>
              v != null && v !== "" ? (Number(v) * 100).toFixed(2) + "%" : "",
          },
          {
            header: "税额",
            key: "taxAmount",
            width: 14,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "不含税金额",
            key: "amountExcludingTax",
            width: 16,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "付款方式",
            key: "paymentMethod",
            width: 12,
            formatter: (v) =>
              v ? (PAYMENT_METHOD_MAP[v as string] ?? (v as string)) : "",
          },
          {
            header: "状态",
            key: "status",
            width: 10,
            formatter: (v) =>
              v ? (CONTRACT_STATUS_MAP[v as string] ?? (v as string)) : "",
          },
          {
            // 合同备注 (Contract.remark): 自由文本, 与 reviewComment 区分; listContracts 已通过 ...c 带回
            header: "合同备注",
            key: "remark",
            width: 40,
          },
        ],
      );
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": attachmentHeader(`合同列表_${ts}.xlsx`),
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
