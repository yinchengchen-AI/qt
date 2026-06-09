"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { formatStatus, type StatusDomain } from "@/lib/status";

const DOMAIN: StatusDomain = "project";

function statusValueEnum(): Record<string, { text: string; status: string }> {
  const out: Record<string, { text: string; status: string }> = {};
  for (const code of [
    "PLANNED",
    "IN_PROGRESS",
    "SUSPENDED",
    "DELIVERED",
    "ACCEPTED",
    "CLOSED",
    "CANCELLED"
  ]) {
    out[code] = { text: formatStatus(code, DOMAIN).label, status: "Default" };
  }
  return out;
}

export default function ProjectsPage() {
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        title="项目管理"
        subtitle="从合同拆解出的可执行项目,跟踪起止期、预算与执行进度"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/projects/new")}>
            新建项目
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
          const res = await fetch(`/api/projects?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          {
            title: "项目编号",
            dataIndex: "projectNo",
            width: 180,
            render: (_, r: any) => <Link href={`/projects/${r.id}`}>{r.projectNo}</Link>
          },
          { title: "项目名称", dataIndex: "name", width: 220 },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], width: 180 },
          { title: "起期", dataIndex: "startDate", valueType: "date", width: 110 },
          { title: "止期", dataIndex: "endDate", valueType: "date", width: 110 },
          { title: "预算（元）", dataIndex: "budgetAmount", width: 120, render: (v: any) => (v ? `¥${v}` : "-") },
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
