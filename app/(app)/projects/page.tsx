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
import { makeListRequest } from "@/lib/use-list-request";
import { downloadExcel } from "@/lib/excel-client";
import { CurrencyCell, DateCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";

type Row = {
  id: string;
  projectNo: string;
  name: string;
  contractId?: string;
  startDate: string;
  endDate: string;
  budgetAmount?: string;
  status: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("project");
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
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined }}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        cardBordered={false}
        sticky={isMobile}
        request={async (params) => {
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            contractId: params.contractId
          };
          return makeListRequest<Row>("/api/projects")(params);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "项目名 / 编号" } },
          {
            title: "项目编号",
            dataIndex: "projectNo",
            search: false,
            width: 180,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => <Link href={`/projects/${r.id}`}>{r.projectNo}</Link>
          },
          { title: "项目名称", dataIndex: "name", search: false, width: 220 },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], search: false, width: 180 },
          { title: "起期", dataIndex: "startDate", search: false, valueType: "date", width: 110, render: (_, r) => <DateCell value={r.startDate} /> },
          { title: "止期", dataIndex: "endDate", search: false, valueType: "date", width: 110, render: (_, r) => <DateCell value={r.endDate} /> },
          { title: "预算(元)", dataIndex: "budgetAmount", search: false, width: 120, render: (_, r) => <CurrencyCell value={r.budgetAmount ?? ""} /> },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="project" />
          }
        ]}
        options={{
          density: !isMobile,
          fullScreen: !isMobile
        }}
      />
    </Page>
  );
}
