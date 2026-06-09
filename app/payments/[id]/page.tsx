"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space, App as AntdApp, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";

export default function PaymentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<any>(`/api/payments/${id}`);
  const [bankRefNo, setBankRefNo] = useState("");
  const [reason, setReason] = useState("");
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/payments")} title="回款详情" />
        <EmptyState loading />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = data.status;
  const callAction = async (action: string, body: any = {}) => {
    const res = await fetch(`/api/payments/${id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (j.code !== 0) { message.error(j.message); return false; }
    message.success("操作成功"); await mutate(); return true;
  };
  const askConfirm = () => Modal.confirm({
    title: "确认回款（财务）",
    content: <Input value={bankRefNo} onChange={(e) => setBankRefNo(e.target.value)} placeholder="银行流水号（必填）" />,
    onOk: async () => {
      if (!bankRefNo) { message.error("请填写银行流水号"); return Promise.reject(); }
      await callAction("confirm", { bankRefNo }); setBankRefNo("");
    }
  });
  const askRefund = () => Modal.confirm({
    title: "退款（财务）",
    content: <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退款原因" />,
    onOk: async () => { await callAction("refund", { reason }); setReason(""); }
  });
  return (
    <Page>
      <PageHeader
        back={() => router.push("/payments")}
        title={`回款 ${data.paymentNo}`}
        subtitle={`到账日: ${data.receivedAt ? new Date(data.receivedAt).toLocaleString("zh-CN") : "-"}`}
        meta={<StatusTag status={data.status} domain="payment" />}
        actions={
          <Space>
            {status === "PLANNED" && <Button type="primary" onClick={askConfirm} disabled={!isFinance}>财务确认</Button>}
            {status === "CONFIRMED" && isFinance && (
              <>
                <Button onClick={() => callAction("reconcile")}>对账</Button>
                <Button danger onClick={askRefund}>退款</Button>
              </>
            )}
            {status === "PLANNED" && <Button danger onClick={() => callAction("cancel")}>取消</Button>}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={2} dataSource={data} columns={[
          { title: "回款号", dataIndex: "paymentNo" },
          { title: "金额", dataIndex: "amount", render: (v: any) => `¥${v}` },
          { title: "方式", dataIndex: "method" },
          { title: "到账日", dataIndex: "receivedAt", valueType: "dateTime" },
          { title: "银行流水号", dataIndex: "bankRefNo" },
          { title: "收款行", dataIndex: "bankName" },
          { title: "登记人", dataIndex: "recorderUserId" },
          { title: "对账人", dataIndex: "reconcileUserId" },
          { title: "对账时间", dataIndex: "reconciledAt", valueType: "dateTime" },
          { title: "备注", dataIndex: "remark" }
        ]} />
      </ProCard>
      {data.invoice && (
        <ProCard title="关联发票">
          <ProDescriptions column={2} dataSource={data.invoice} columns={[
            { title: "发票号", dataIndex: "invoiceNo" },
            { title: "金额", dataIndex: "amount", render: (v: any) => `¥${v}` }
          ]} />
        </ProCard>
      )}
      <ProCard title="分配明细">
        <ProTable rowKey="id" search={false} options={false} pagination={false} dataSource={data.allocations ?? []} columns={[
          { title: "发票 ID", dataIndex: "invoiceId" },
          { title: "项目 ID", dataIndex: "projectId" },
          { title: "金额", dataIndex: "amount", render: (v: any) => `¥${v}` },
          { title: "备注", dataIndex: "remark" }
        ]} />
      </ProCard>
    </Page>
  );
}
