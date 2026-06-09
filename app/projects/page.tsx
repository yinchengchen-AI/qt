"use client";
import { ProTable, ProCard } from "@ant-design/pro-components";
import { Tag, Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", IN_PROGRESS: "processing", SUSPENDED: "orange",
  DELIVERED: "cyan", ACCEPTED: "green", CLOSED: "blue", CANCELLED: "red"
};

export default function ProjectsPage() {
  const router = useRouter();
  return (
    <ProCard>
      <ProTable
        headerTitle="项目管理"
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        toolBarRender={() => [<Button key="add" type="primary" onClick={() => router.push("/projects/new")}>新建项目</Button>]}
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
          { title: "项目编号", dataIndex: "projectNo", width: 180,
            render: (_, r: any) => <Link href={`/projects/${r.id}`}>{r.projectNo}</Link> },
          { title: "项目名称", dataIndex: "name", width: 220 },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], width: 180 },
          { title: "起期", dataIndex: "startDate", valueType: "date", width: 110 },
          { title: "止期", dataIndex: "endDate", valueType: "date", width: 110 },
          { title: "预算（元）", dataIndex: "budgetAmount", width: 120, render: (v: any) => (v ? `¥${v}` : "-") },
          { title: "状态", dataIndex: "status", width: 100, render: (_, r: any) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag> }
        ]}
      />
    </ProCard>
  );
}
