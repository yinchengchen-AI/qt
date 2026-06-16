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
import { CurrencyCell, DateCell, PercentCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";

type Row = {
  id: string;
  invoiceNo: string;
  customerName: string;
  amount: string;
  taxRate: string;
  taxAmount: string;
  applyDate: string;
  actualIssueDate: string | null;
  status: string;
};

export default function InvoicesPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("invoice");
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    try {
      await downloadExcel(`/api/invoices/export${qs.toString() ? `?${qs}` : ""}`, "invoices.xlsx");
      message.success("已开始下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="开票管理"
        subtitle="合同开票申请、审核、实际开票与红冲;按状态 / 客户 / 合同筛选"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/invoices/new")}>
              新建开票
            </Button>
          </>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined }}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        cardBordered={false}
        sticky={isMobile}
        request={async (params) => {
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            contractId: params.contractId
          };
          return makeListRequest<Row>("/api/invoices")(params);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "发票号 / 客户名" } },
          {
            title: "发票号",
            dataIndex: "invoiceNo",
            search: false,
            width: 200,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => r.invoiceNo ? <Link href={`/invoices/${r.id}`}>{r.invoiceNo}</Link> : <Link href={`/invoices/${r.id}`}>未开</Link>
          },
          { title: "客户", dataIndex: "customerName", search: false, width: 180 },
          { title: "金额(含税)", dataIndex: "amount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.amount} /> },
          { title: "税率", dataIndex: "taxRate", search: false, width: 80, render: (_, r) => <PercentCell value={r.taxRate} /> },
          { title: "税额", dataIndex: "taxAmount", search: false, width: 120, render: (_, r) => <CurrencyCell value={r.taxAmount} /> },
          { title: "申请日", dataIndex: "applyDate", search: false, valueType: "date", width: 120, render: (_, r) => <DateCell value={r.applyDate} /> },
          { title: "实际开票日", dataIndex: "actualIssueDate", search: false, valueType: "date", width: 120, render: (_, r) => <DateCell value={r.actualIssueDate} /> },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="invoice" />
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
