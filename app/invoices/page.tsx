"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { formatStatus, type StatusDomain } from "@/lib/status";

const DOMAIN: StatusDomain = "invoice";

function statusValueEnum(): Record<string, { text: string; status: string }> {
  const out: Record<string, { text: string; status: string }> = {};
  for (const code of ["DRAFT", "PENDING_FINANCE", "ISSUED", "REJECTED", "VOIDED", "RED_FLUSHED"]) {
    out[code] = { text: formatStatus(code, DOMAIN).label, status: "Default" };
  }
  return out;
}

export default function InvoicesPage() {
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        title="开票管理"
        subtitle="项目开票申请、审核、实际开票与红冲;按状态 / 客户 / 项目筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/invoices/new")}>
            新建开票
          </Button>
        }
      />
      <ProTable
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        cardBordered={false}
        request={async (params) => {
          const qs = new URLSearchParams({ page: String(params.current ?? 1), pageSize: String(params.pageSize ?? 20) });
          if (params.keyword) qs.set("keyword", params.keyword);
          if (params.status) qs.set("status", params.status);
          const res = await fetch(`/api/invoices?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          {
            title: "发票号",
            dataIndex: "invoiceNo",
            width: 200,
            render: (_, r: any) => <Link href={`/invoices/${r.id}`}>{r.invoiceNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "金额（含税）", dataIndex: "amount", width: 140, render: (v: any) => `¥${v}` },
          { title: "税率", dataIndex: "taxRate", width: 80, render: (v: any) => `${(Number(v) * 100).toFixed(2)}%` },
          { title: "税额", dataIndex: "taxAmount", width: 120, render: (v: any) => `¥${v}` },
          { title: "申请日", dataIndex: "applyDate", valueType: "date", width: 120 },
          { title: "实际开票日", dataIndex: "actualIssueDate", valueType: "date", width: 120, render: (v: any) => v ?? "-" },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusValueEnum(),
            render: (_, r: any) => <StatusTag status={r.status} domain={DOMAIN} />
          }
        ]}
      />
    </Page>
  );
}
