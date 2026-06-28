"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button, App as AntdApp, Tag } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { makeListRequest } from "@/lib/use-list-request";
import { useDict } from "@/lib/dict-client";
import { downloadExcel } from "@/lib/excel-client";
import { CurrencyCell, DateCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";
import { BILLING_STATUS_MAP } from "@/lib/enum-maps";

type Row = {
  id: string;
  contractNo: string;
  customerName: string;
  title: string;
  serviceType: string;
  signDate: string;
  totalAmount: string;
  invoicedAmount: number;
  paidAmount: number;
  billingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  ownerUserId: string;
  ownerName: string;
  ownerEmployeeNo: string;
  status: string;
};

export default function ContractsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("contract");
  const serviceTypeDict = useDict("SERVICE_TYPE");
  const serviceTypeEnum = Object.fromEntries(
    serviceTypeDict.map((d) => [d.code, { text: d.label }])
  );
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    try {
      await downloadExcel(`/api/contracts/export${qs.toString() ? `?${qs}` : ""}`, "合同列表.xlsx");
      message.success("已开始下载，请稍候");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="合同管理"
        subtitle="覆盖合同全生命周期：草稿、审批、生效、执行 / 终止；支持按客户、状态筛选"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/contracts/new")}>
              新建合同
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
            customerId: params.customerId
          };
          return makeListRequest<Row>("/api/contracts")(params);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "合同号 / 标题 / 客户名" } },
          {
            title: "合同号",
            dataIndex: "contractNo",
            search: false,
            width: 180,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => <Link href={`/contracts/${r.id}`}>{r.contractNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", search: false, width: 180 },
          { title: "负责人", dataIndex: "ownerUserId", search: false, width: 110, render: (_, r) => r.ownerName || "—" },
          { title: "合同标题", dataIndex: "title", search: false, width: 240 },
          {
            title: "服务类型",
            dataIndex: "serviceType",
            search: false,
            width: 120,
            valueEnum: serviceTypeEnum,
            render: (_, r) => serviceTypeDict.find((d) => d.code === r.serviceType)?.label ?? r.serviceType
          },
          { title: "签订日", dataIndex: "signDate", search: false, valueType: "date", width: 120, render: (_, r) => <DateCell value={r.signDate} /> },
          { title: "总额(元)", dataIndex: "totalAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.totalAmount} /> },
          { title: "已开票(元)", dataIndex: "invoicedAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.invoicedAmount} /> },
          { title: "已回款(元)", dataIndex: "paidAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.paidAmount} /> },
          {
            title: "开票状态",
            dataIndex: "billingStatus",
            search: false,
            width: 110,
            render: (_, r) => {
              const color = r.billingStatus === "COMPLETED" ? "success" : r.billingStatus === "IN_PROGRESS" ? "processing" : "default";
              return <Tag color={color}>{BILLING_STATUS_MAP[r.billingStatus] ?? r.billingStatus}</Tag>;
            }
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="contract" />
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
