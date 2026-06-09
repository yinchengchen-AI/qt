"use client";
import { ProTable, ProCard } from "@ant-design/pro-components";
import { Tag, Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", PENDING_FINANCE: "processing", ISSUED: "green",
  REJECTED: "red", VOIDED: "volcano", RED_FLUSHED: "purple"
};

export default function InvoicesPage() {
  const router = useRouter();
  return (
    <ProCard>
      <ProTable
        headerTitle="开票管理"
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        toolBarRender={() => [<Button key="add" type="primary" onClick={() => router.push("/invoices/new")}>新建开票</Button>]}
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
          { title: "发票号", dataIndex: "invoiceNo", width: 200,
            render: (_, r: any) => <Link href={`/invoices/${r.id}`}>{r.invoiceNo}</Link> },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "金额（含税）", dataIndex: "amount", width: 140, render: (v: any) => `¥${v}` },
          { title: "税率", dataIndex: "taxRate", width: 80, render: (v: any) => `${(Number(v) * 100).toFixed(2)}%` },
          { title: "税额", dataIndex: "taxAmount", width: 120, render: (v: any) => `¥${v}` },
          { title: "申请日", dataIndex: "applyDate", valueType: "date", width: 120 },
          { title: "实际开票日", dataIndex: "actualIssueDate", valueType: "date", width: 120, render: (v: any) => v ?? "-" },
          { title: "状态", dataIndex: "status", width: 110, render: (_, r: any) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag> }
        ]}
      />
    </ProCard>
  );
}
