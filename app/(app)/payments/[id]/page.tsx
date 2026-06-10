"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import type { Payment as PaymentEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
const METHOD_MAP: Record<string, string> = { BANK_TRANSFER: "银行转账", CHECK: "支票", CASH: "现金", WECHAT: "微信", ALIPAY: "支付宝", OTHER: "其他" };

export default function PaymentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<{ data: PaymentEntity }>(`/api/payments/${id}`);
  const payment = data?.data;
  const [bankRefNo, setBankRefNo] = useState("");
  const [reason, setReason] = useState("");
  const { run } = useActionCall({ baseUrl: `/api/payments/${id}`, reload: () => mutate() });

  if (isLoading || !payment) {
    return (
      <Page>
        <PageHeader back={() => router.push("/payments")} title="回款详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = payment.status;

  const askConfirm = () => Modal.confirm({
    title: "确认回款(财务)",
    content: <Input value={bankRefNo} onChange={(e) => setBankRefNo(e.target.value)} placeholder="银行流水号(必填)" />,
    onOk: async () => {
      if (!bankRefNo) { Modal.destroyAll(); return; }
      await run("confirm", { bankRefNo }); setBankRefNo("");
    }
  });
  const askRefund = () => Modal.confirm({
    title: "退款(财务)",
    content: <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退款原因" />,
    onOk: async () => { await run("refund", { reason }); setReason(""); }
  });
  return (
    <Page>
      <PageHeader
        back={() => router.push("/payments")}
        title={`回款 ${payment.paymentNo}`}
        subtitle={`到账日: ${payment.receivedAt ? new Date(payment.receivedAt).toLocaleString("zh-CN") : "-"}`}
        meta={<StatusTag status={payment.status} domain="payment" />}
        actions={
          <Space>
            {status === "PLANNED" && <Button type="primary" onClick={askConfirm} disabled={!isFinance}>财务确认</Button>}
            {status === "CONFIRMED" && isFinance && (
              <>
                <Button onClick={() => run("reconcile")}>对账</Button>
                <Button danger onClick={askRefund}>退款</Button>
              </>
            )}
            {status === "PLANNED" && <Button danger onClick={() => run("cancel")}>取消</Button>}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={2} dataSource={payment} columns={[
          { title: "回款号", dataIndex: "paymentNo" },
          { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "方式", dataIndex: "method", render: (v) => METHOD_MAP[v as string] ?? v },
          { title: "到账日", dataIndex: "receivedAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "银行流水号", dataIndex: "bankRefNo" },
          { title: "收款行", dataIndex: "bankName" },
          { title: "登记人", dataIndex: "recorderUserId" },
          { title: "对账人", dataIndex: "reconcileUserId" },
          { title: "对账时间", dataIndex: "reconciledAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "备注", dataIndex: "remark" }
        ]} />
      </ProCard>
      {payment.invoice && (
        <>
          <PageHeader level="section" title="关联发票" />
          <ProCard>
            <ProDescriptions column={2} dataSource={payment.invoice} columns={[
              { title: "发票号", dataIndex: "invoiceNo" },
              { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> }
            ]} />
          </ProCard>
        </>
      )}
      <PageHeader level="section" title="分配明细" />
      <ProCard>
        <ProTable rowKey="id" search={false} options={false} pagination={false} dataSource={payment.allocations ?? []} columns={[
          { title: "发票编号", dataIndex: "invoiceId" },
          { title: "项目编号", dataIndex: "projectId" },
          { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "备注", dataIndex: "remark" }
        ]} />
      </ProCard>
    </Page>
  );
}
