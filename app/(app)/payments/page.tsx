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
import { useDict } from "@/lib/dict-client";
import { downloadExcel } from "@/lib/excel-client";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";

type Row = {
  id: string;
  paymentNo: string;
  amount: string;
  method: string;
  receivedAt: string;
  bankRefNo: string;
  status: string;
};

export default function PaymentsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("payment");
  const methodDict = useDict("PAYMENT_RECEIVE_METHOD");
  const methodEnum = Object.fromEntries(methodDict.map((d) => [d.code, { text: d.label }]));
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    try {
      await downloadExcel(`/api/payments/export${qs.toString() ? `?${qs}` : ""}`, "payments.xlsx");
      message.success("已开始下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="回款管理"
        subtitle="登记银行到账、确认、对账与退款;按合同 / 发票 / 状态筛选"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/payments/new")}>
              登记回款
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
            contractId: params.contractId,
            invoiceId: params.invoiceId
          };
          return makeListRequest<Row>("/api/payments")(params);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "回款号 / 银行流水号 / 客户名称" } },
          {
            title: "回款号",
            dataIndex: "paymentNo",
            search: false,
            width: 200,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => <Link href={`/payments/${r.id}`}>{r.paymentNo}</Link>
          },
          { title: "金额", dataIndex: "amount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.amount} /> },
          {
            title: "方式",
            dataIndex: "method",
            search: false,
            width: 100,
            valueEnum: methodEnum,
            render: (_, r) => methodDict.find((d) => d.code === r.method)?.label ?? r.method
          },
          { title: "到账日", dataIndex: "receivedAt", search: false, valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.receivedAt} /> },
          { title: "银行流水号", dataIndex: "bankRefNo", search: false, width: 200 },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="payment" />
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
