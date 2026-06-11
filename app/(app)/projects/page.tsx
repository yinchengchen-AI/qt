"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button, App as AntdApp } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { useDict } from "@/lib/dict-client";
import { SERVICE_TYPE_MAP } from "@/lib/enum-maps";
import { makeListRequest } from "@/lib/use-list-request";
import { downloadExcel } from "@/lib/excel-client";
import { CurrencyCell, DateCell } from "@/components/table-cells";

type Row = {
  id: string;
  projectNo: string;
  name: string;
  contractId?: string;
  contract?: { contractNo: string; serviceType?: string };
  serviceType?: string;
  startDate: string;
  endDate: string;
  budgetAmount?: string;
  status: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const statusEnum = useStatusValueEnum("project");
  const serviceTypeDict = useDict("SERVICE_TYPE");
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    try {
      await downloadExcel(`/api/projects/export${qs.toString() ? `?${qs}` : ""}`, "projects.xlsx");
      message.success("已开始下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="项目管理"
        subtitle="从合同拆解出的可执行项目,跟踪起止期、预算与执行进度"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/projects/new")}>
              新建项目
            </Button>
          </>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        cardBordered={false}
        request={async (params) => {
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            contractId: params.contractId
          };
          return makeListRequest<Row>("/api/projects")(params);
        }}
        columns={[
          {
            title: "项目编号",
            dataIndex: "projectNo",
            width: 180,
            render: (_, r) => <Link href={`/projects/${r.id}`}>{r.projectNo}</Link>
          },
          { title: "项目名称", dataIndex: "name", width: 220 },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], width: 180 },
          {
            title: "服务类型",
            dataIndex: "serviceType",
            width: 110,
            render: (_, r) => {
              const code = r.serviceType ?? r.contract?.serviceType;
              if (!code) return "—";
              return serviceTypeDict.find((d) => d.code === code)?.label ?? SERVICE_TYPE_MAP[code] ?? code;
            }
          },
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
