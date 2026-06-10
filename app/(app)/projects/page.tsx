"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { makeListRequest } from "@/lib/use-list-request";
import { CurrencyCell, DateCell } from "@/components/table-cells";

type Row = {
  id: string;
  projectNo: string;
  name: string;
  contractId?: string;
  contract?: { contractNo: string };
  startDate: string;
  endDate: string;
  budgetAmount?: string;
  status: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const statusEnum = useStatusValueEnum("project");

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
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        cardBordered={false}
        request={makeListRequest<Row>("/api/projects")}
        columns={[
          {
            title: "项目编号",
            dataIndex: "projectNo",
            width: 180,
            render: (_, r) => <Link href={`/projects/${r.id}`}>{r.projectNo}</Link>
          },
          { title: "项目名称", dataIndex: "name", width: 220 },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], width: 180 },
          { title: "起期", dataIndex: "startDate", valueType: "date", width: 110, render: (_, r) => <DateCell value={r.startDate} /> },
          { title: "止期", dataIndex: "endDate", valueType: "date", width: 110, render: (_, r) => <DateCell value={r.endDate} /> },
          { title: "预算(元)", dataIndex: "budgetAmount", width: 120, render: (_, r) => <CurrencyCell value={r.budgetAmount ?? ""} /> },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="project" />
          }
        ]}
      />
    </Page>
  );
}
