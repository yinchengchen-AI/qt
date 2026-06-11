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
import { CurrencyCell, DateCell } from "@/components/table-cells";

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

export default function ContractsPage() {
  const router = useRouter();
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
      await downloadExcel(`/api/contracts/export${qs.toString() ? `?${qs}` : ""}`, "contracts.xlsx");
      message.success("已开始下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="合同管理"
        subtitle="从草稿、审批、生效到执行/终止的全生命周期;支持按客户、状态筛选"
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
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        cardBordered={false}
        request={async (params) => {
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            customerId: params.customerId
          };
          return makeListRequest<Row>("/api/contracts")(params);
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
          {
            title: "服务类型",
            dataIndex: "serviceType",
            width: 120,
            valueEnum: serviceTypeEnum,
            render: (_, r) => serviceTypeDict.find((d) => d.code === r.serviceType)?.label ?? r.serviceType
          },
          { title: "签订日", dataIndex: "signDate", valueType: "date", width: 120, render: (_, r) => <DateCell value={r.signDate} /> },
          { title: "总额(元)", dataIndex: "totalAmount", width: 140, render: (_, r) => <CurrencyCell value={r.totalAmount} /> },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="contract" />
          }
        ]}
      />
    </Page>
  );
}
