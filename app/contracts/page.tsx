"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { formatStatus, type StatusDomain } from "@/lib/status";

type Row = {
  id: string;
  contractNo: string;
  customerName: string;
  title: string;
  serviceType: string;
  signDate: string;
  totalAmount: string;
  status: string;
};

const DOMAIN: StatusDomain = "contract";

function statusValueEnum(): Record<string, { text: string; status: string }> {
  const out: Record<string, { text: string; status: string }> = {};
  for (const code of [
    "DRAFT",
    "PENDING_REVIEW",
    "EFFECTIVE",
    "EXECUTING",
    "COMPLETED",
    "TERMINATED",
    "EXPIRED"
  ]) {
    out[code] = { text: formatStatus(code, DOMAIN).label, status: "Default" };
  }
  return out;
}

export default function ContractsPage() {
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        title="合同管理"
        subtitle="从草稿、审批、生效到执行/终止的全生命周期;支持按客户、状态筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/contracts/new")}>
            新建合同
          </Button>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        cardBordered={false}
        request={async (params) => {
          const qs = new URLSearchParams({
            page: String(params.current ?? 1),
            pageSize: String(params.pageSize ?? 20)
          });
          if (params.keyword) qs.set("keyword", params.keyword);
          if (params.status) qs.set("status", params.status);
          const res = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          {
            title: "合同号",
            dataIndex: "contractNo",
            width: 180,
            render: (_, r) => <Link href={`/contracts/${r.id}`}>{r.contractNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "合同标题", dataIndex: "title", width: 240 },
          { title: "服务类型", dataIndex: "serviceType", width: 120 },
          { title: "签订日", dataIndex: "signDate", valueType: "date", width: 120 },
          { title: "总额（元）", dataIndex: "totalAmount", width: 140, render: (v: any) => `¥${v}` },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusValueEnum(),
            render: (_, r) => <StatusTag status={r.status} domain={DOMAIN} />
          }
        ]}
      />
    </Page>
  );
}
