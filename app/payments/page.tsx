"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { formatStatus, type StatusDomain } from "@/lib/status";

const DOMAIN: StatusDomain = "payment";

function statusValueEnum(): Record<string, { text: string; status: string }> {
  const out: Record<string, { text: string; status: string }> = {};
  for (const code of ["PLANNED", "CONFIRMED", "RECONCILED", "REFUNDED", "CANCELLED"]) {
    out[code] = { text: formatStatus(code, DOMAIN).label, status: "Default" };
  }
  return out;
}

export default function PaymentsPage() {
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        title="回款管理"
        subtitle="登记银行到账、确认、对账与退款;按合同 / 发票 / 状态筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/payments/new")}>
            登记回款
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
          if (params.contractId) qs.set("contractId", params.contractId);
          if (params.invoiceId) qs.set("invoiceId", params.invoiceId);
          const res = await fetch(`/api/payments?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          {
            title: "回款号",
            dataIndex: "paymentNo",
            width: 200,
            render: (_, r: any) => <Link href={`/payments/${r.id}`}>{r.paymentNo}</Link>
          },
          { title: "金额", dataIndex: "amount", width: 140, render: (v: any) => `¥${v}` },
          { title: "方式", dataIndex: "method", width: 100 },
          { title: "到账日", dataIndex: "receivedAt", valueType: "dateTime", width: 180 },
          { title: "银行流水号", dataIndex: "bankRefNo", width: 200 },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusValueEnum(),
            render: (_, r: any) => <StatusTag status={r.status} domain={DOMAIN} />
          }
        ]}
      />
    </Page>
  );
}
