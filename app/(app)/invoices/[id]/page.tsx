"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Button, Space, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import type { AttachmentSnapshot, Invoice as InvoiceEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { CurrencyCell, DateTimeCell, PercentCell } from "@/components/table-cells";
import { AttachmentList } from "@/components/file/attachment-list";
const INVOICE_TYPE_MAP: Record<string, string> = { VAT_SPECIAL: "增值税专用发票", VAT_GENERAL: "增值税普通发票", VAT_ELECTRONIC: "增值税电子专票", ELEC_NORMAL: "电子普通发票" };
const TITLE_TYPE_MAP: Record<string, string> = { COMPANY: "公司", PERSONAL: "个人" };

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<{ data: InvoiceEntity }>(`/api/invoices/${id}`);
  const invoice = data?.data;
  const [reason, setReason] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const { run } = useActionCall({ baseUrl: `/api/invoices/${id}`, reload: () => mutate() });

  if (isLoading || !invoice) {
    return (
      <Page>
        <PageHeader back={() => router.push("/invoices")} title="开票详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = invoice?.status;

  const askIssue = () => Modal.confirm({
    title: "开票(财务)",
    content: <div><div>发票号(电子发票 20 位数字):</div><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="如 01100210031112345678" /></div>,
    onOk: async () => {
      if (!invoiceNo) { Modal.destroyAll(); return; }
      await run("issue", { invoiceNo, actualIssueDate: new Date().toISOString() });
      setInvoiceNo("");
    }
  });
  const askRedFlush = () => Modal.confirm({
    title: "红冲发票",
    content: <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="红冲原因" />,
    onOk: async () => { await run("red-flush", { reason }); setReason(""); }
  });
  const askReject = () => Modal.confirm({
    title: "驳回开票",
    content: <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回原因" />,
    onOk: async () => { await run("reject", { reason }); setReason(""); }
  });
  const askVoid = () => Modal.confirm({
    title: "作废发票(仅当日)",
    content: <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="作废原因" />,
    onOk: async () => { await run("void", { reason }); setReason(""); }
  });
  return (
    <Page>
      <PageHeader
        back={() => router.push("/invoices")}
        title={`${invoice.customerName} · ${invoice.invoiceNo}`}
        subtitle={`发票类型: ${invoice.invoiceType ?? "-"}`}
        meta={<StatusTag status={invoice.status} domain="invoice" />}
        actions={
          <Space>
            {status === "DRAFT" && <Button type="primary" onClick={() => run("submit")}>提交</Button>}
            {status === "PENDING_FINANCE" && isFinance && (
              <>
                <Button danger onClick={askReject}>驳回</Button>
                <Button type="primary" onClick={askIssue}>开票</Button>
              </>
            )}
            {status === "ISSUED" && isFinance && (
              <>
                <Button onClick={askVoid}>作废(当日)</Button>
                <Button danger onClick={askRedFlush}>红冲</Button>
              </>
            )}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<InvoiceEntity> column={2} dataSource={invoice} columns={[
          { title: "发票号", dataIndex: "invoiceNo" },
          { title: "客户", dataIndex: "customerName" },
          { title: "发票类型", dataIndex: "invoiceType", render: (v) => INVOICE_TYPE_MAP[v as string] ?? v },
          { title: "含税金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "税额", dataIndex: "taxAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "不含税金额", dataIndex: "amountExcludingTax", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "税率", dataIndex: "taxRate", render: (v) => <PercentCell value={v as string} /> },
          { title: "申请日", dataIndex: "applyDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "实际开票日", dataIndex: "actualIssueDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "抬头类型", dataIndex: "titleType", render: (v) => TITLE_TYPE_MAP[v as string] ?? v },
          { title: "抬头名称", dataIndex: "titleName" },
          { title: "税号", dataIndex: "taxNo" },
          { title: "开户行", dataIndex: "bankName" },
          { title: "银行账号", dataIndex: "bankAccount" },
          { title: "地址", dataIndex: "address" },
          { title: "电话", dataIndex: "phone" }
        ]} />
      </ProCard>
      <PageHeader level="section" title="附件" />
      <ProCard>
        <AttachmentList
          items={(invoice?.attachments ?? []).map((a: AttachmentSnapshot) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            legacyUrl: typeof a.url === "string" ? a.url : undefined
          }))}
          onDeleted={() => mutate()}
        />
      </ProCard>
    </Page>
  );
}
