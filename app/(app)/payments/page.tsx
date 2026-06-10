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
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";

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
  const statusEnum = useStatusValueEnum("payment");

  return (
    <Page>
      <PageHeader
        title="回款管理"
        subtitle="登记银行到账、确认、对账与退款;按合同 / 发票 / 状态筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/payments/new")}>
            登记回款
          </Button>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20 }}
        cardBordered={false}
        request={makeListRequest<Row>("/api/payments")}
        columns={[
          {
            title: "回款号",
            dataIndex: "paymentNo",
            width: 200,
            render: (_, r) => <Link href={`/payments/${r.id}`}>{r.paymentNo}</Link>
          },
          { title: "金额", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount} /> },
          { title: "方式", dataIndex: "method", width: 100 },
          { title: "到账日", dataIndex: "receivedAt", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.receivedAt} /> },
          { title: "银行流水号", dataIndex: "bankRefNo", width: 200 },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="payment" />
          }
        ]}
      />
    </Page>
  );
}
