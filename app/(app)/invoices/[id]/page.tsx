"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Button, Space, Modal, Input, App as AntdApp } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
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
import { EditOutlined, FilePdfOutlined } from "@ant-design/icons";
import { openPrintWindow } from "@/lib/print-client";
import { AttachmentList } from "@/components/file/attachment-list";
import { INVOICE_TYPE_MAP, TITLE_TYPE_MAP } from "@/lib/enum-maps";

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = String(params.id);

  const goBack = useGoBack("/invoices");
  const router = useRouter();
  const { data: session } = useSession();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<InvoiceEntity>(`/api/invoices/${id}`);
  const invoice = data;
  type ModalType = "issue" | "redFlush" | "reject" | "void" | null;
  const [modalOpen, setModalOpen] = useState<ModalType>(null);
  const [reason, setReason] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");

  const openModal = (type: NonNullable<ModalType>) => {
    setModalOpen(type);
    setReason("");
    setInvoiceNo(invoice?.invoiceNo ?? "");
  };
  const closeModal = () => setModalOpen(null);

  const { run } = useActionCall({ baseUrl: `/api/invoices/${id}`, reload: () => mutate() });

  if (isLoading || !invoice) {
    return (
      <Page>
        <PageHeader back={goBack} title="开票详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const roleCode = (session?.user?.roleCode ?? "") as Parameters<typeof hasPermission>[0];
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const isAdmin = roleCode === "ADMIN";
  // 与 server/services/invoice/crud.ts:130 的状态机门控保持一致: 非 admin 仅 DRAFT 可改, admin 任意态
  const canUpdate = hasPermission(roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  const status = invoice?.status;

  const handleIssue = async () => {
    if (!invoiceNo) { message.warning("请先填写 20 位电子发票号"); throw new Error("empty invoiceNo"); }
    const ok = await run("issue", { invoiceNo, actualIssueDate: new Date().toISOString() });
    if (!ok) throw new Error("issue failed");
    setInvoiceNo("");
  };
  const handleRedFlush = async () => {
    if (!reason.trim()) { message.warning("请填写红冲原因"); throw new Error("empty reason"); }
    const ok = await run("red-flush", { reason });
    if (!ok) throw new Error("red-flush failed");
    setReason("");
  };
  const handleReject = async () => {
    if (!reason.trim()) { message.warning("请填写驳回原因"); throw new Error("empty reason"); }
    const ok = await run("reject", { reason });
    if (!ok) throw new Error("reject failed");
    setReason("");
  };
  const handleVoid = async () => {
    if (!reason.trim()) { message.warning("请填写作废原因"); throw new Error("empty reason"); }
    const ok = await run("void", { reason });
    if (!ok) throw new Error("void failed");
    setReason("");
  };
  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`${invoice.customerName} · ${invoice.invoiceNo}`}
        subtitle={`发票类型：${INVOICE_TYPE_MAP[invoice.invoiceType as string] ?? invoice.invoiceType ?? "—"}`}
        meta={<StatusTag status={invoice.status} domain="invoice" />}
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/invoices/${id}/pdf`)}>导出 PDF</Button>
            {canUpdate && (isAdmin || status === "DRAFT") && (
              <Button key="edit" icon={<EditOutlined />} onClick={() => router.push(`/invoices/${id}/edit`)}>编辑</Button>
            )}
            {status === "DRAFT" && isFinance && <Button type="primary" onClick={() => run("submit")}>提交</Button>}
            {status === "PENDING_FINANCE" && isFinance && (
              <>
                <Button danger onClick={() => openModal("reject")}>驳回</Button>
                <Button type="primary" onClick={() => openModal("issue")}>开票</Button>
              </>
            )}
            {status === "ISSUED" && isFinance && (
              <>
                <Button onClick={() => openModal("void")}>作废(当日)</Button>
                <Button danger onClick={() => openModal("redFlush")}>红冲</Button>
              </>
            )}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<InvoiceEntity> column={DESC_COL} dataSource={invoice} columns={[
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
      <Modal
        title="确认开票（财务操作）"
        open={modalOpen === "issue"}
        onOk={handleIssue}
        onCancel={closeModal}
        destroyOnClose
      >
        <div style={{ marginBottom: 6 }}>请填写 20 位电子发票号：</div>
        <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="如：01100210031112345678" />
      </Modal>
      <Modal
        title="确认红冲发票？"
        open={modalOpen === "redFlush"}
        onOk={handleRedFlush}
        onCancel={closeModal}
        destroyOnClose
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写红冲原因，将记入操作记录" />
      </Modal>
      <Modal
        title="确认驳回该开票？"
        open={modalOpen === "reject"}
        onOk={handleReject}
        onCancel={closeModal}
        destroyOnClose
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写驳回原因，业务员可见" />
      </Modal>
      <Modal
        title="确认作废该发票？（仅当日有效）"
        open={modalOpen === "void"}
        onOk={handleVoid}
        onCancel={closeModal}
        destroyOnClose
      >
        <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写作废原因，将记入操作记录" />
      </Modal>
    </Page>
  );
}
