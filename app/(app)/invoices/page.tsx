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
import { CurrencyCell, DateCell, PercentCell } from "@/components/table-cells";

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
  const statusEnum = useStatusValueEnum("invoice");

  return (
    <Page>
      <PageHeader
        title="开票管理"
        subtitle="合同开票申请、审核、实际开票与红冲;按状态 / 客户 / 合同筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/invoices/new")}>
            新建开票
          </Button>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        cardBordered={false}
        request={makeListRequest<Row>("/api/invoices")}
        columns={[
          {
            title: "发票号",
            dataIndex: "invoiceNo",
            width: 200,
            render: (_, r) => <Link href={`/invoices/${r.id}`}>{r.invoiceNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "金额(含税)", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount} /> },
          { title: "税率", dataIndex: "taxRate", width: 80, render: (_, r) => <PercentCell value={r.taxRate} /> },
          { title: "税额", dataIndex: "taxAmount", width: 120, render: (_, r) => <CurrencyCell value={r.taxAmount} /> },
          { title: "申请日", dataIndex: "applyDate", valueType: "date", width: 120, render: (_, r) => <DateCell value={r.applyDate} /> },
          { title: "实际开票日", dataIndex: "actualIssueDate", valueType: "date", width: 120, render: (_, r) => <DateCell value={r.actualIssueDate} /> },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="invoice" />
          }
        ]}
      />
    </Page>
  );
}
