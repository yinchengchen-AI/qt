"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Button, Space, App as AntdApp, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<any>(`/api/invoices/${id}`);
  const [reason, setReason] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/invoices")} title="开票详情" />
        <EmptyState loading />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = data.status;
  const callAction = async (action: string, body: any = {}) => {
    const res = await fetch(`/api/invoices/${id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (j.code !== 0) { message.error(j.message); return false; }
    message.success("操作成功"); await mutate(); return true;
  };
  const askIssue = () => Modal.confirm({
    title: "开票（财务）",
    content: <div><div>发票号（电子发票 20 位数字）：</div><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="如 01100210031112345678" /></div>,
    onOk: async () => {
      if (!invoiceNo) { message.error("请输入发票号"); return Promise.reject(); }
      await callAction("issue", { invoiceNo, actualIssueDate: new Date().toISOString() });
      setInvoiceNo("");
    }
  });
  const askRedFlush = () => Modal.confirm({
    title: "红冲发票",
    content: <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="红冲原因" />,
    onOk: async () => { await callAction("red-flush", { reason }); setReason(""); }
  });
  const askReject = () => Modal.confirm({
    title: "驳回开票",
    content: <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回原因" />,
    onOk: async () => { await callAction("reject", { reason }); setReason(""); }
  });
  const askVoid = () => Modal.confirm({
    title: "作废发票（仅当日）",
    content: <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="作废原因" />,
    onOk: async () => { await callAction("void", { reason }); setReason(""); }
  });
  return (
    <Page>
      <PageHeader
        back={() => router.push("/invoices")}
        title={`${data.customerName} · ${data.invoiceNo}`}
        subtitle={`发票类型: ${data.invoiceType ?? "-"}`}
        meta={<StatusTag status={data.status} domain="invoice" />}
        actions={
          <Space>
            {status === "DRAFT" && <Button type="primary" onClick={() => callAction("submit")}>提交</Button>}
            {status === "PENDING_FINANCE" && isFinance && (
              <>
                <Button danger onClick={askReject}>驳回</Button>
                <Button type="primary" onClick={askIssue}>开票</Button>
              </>
            )}
            {status === "ISSUED" && isFinance && (
              <>
                <Button onClick={askVoid}>作废（当日）</Button>
                <Button danger onClick={askRedFlush}>红冲</Button>
              </>
            )}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={2} dataSource={data} columns={[
          { title: "发票号", dataIndex: "invoiceNo" },
          { title: "客户", dataIndex: "customerName" },
          { title: "发票类型", dataIndex: "invoiceType" },
          { title: "含税金额", dataIndex: "amount", render: (v: any) => `¥${v}` },
          { title: "税额", dataIndex: "taxAmount", render: (v: any) => `¥${v}` },
          { title: "不含税金额", dataIndex: "amountExcludingTax", render: (v: any) => `¥${v}` },
          { title: "税率", dataIndex: "taxRate", render: (v: any) => `${(Number(v) * 100).toFixed(2)}%` },
          { title: "申请日", dataIndex: "applyDate", valueType: "dateTime" },
          { title: "实际开票日", dataIndex: "actualIssueDate", valueType: "dateTime" },
          { title: "抬头类型", dataIndex: "titleType" },
          { title: "抬头名称", dataIndex: "titleName" },
          { title: "税号", dataIndex: "taxNo" },
          { title: "开户行", dataIndex: "bankName" },
          { title: "银行账号", dataIndex: "bankAccount" },
          { title: "地址", dataIndex: "address" },
          { title: "电话", dataIndex: "phone" }
        ]} />
      </ProCard>
    </Page>
  );
}
