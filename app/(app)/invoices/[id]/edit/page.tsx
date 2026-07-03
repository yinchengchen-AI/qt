"use client";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { proCustomRequest } from "@/lib/upload-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import type { AttachmentSnapshot } from "@/lib/types/entities";
import { TAX_RATE_OPTIONS, TAX_RATE_LABELS } from "@/lib/validators/_shared";
import type { Invoice as InvoiceEntity } from "@/lib/types/entities";
import { useGoBack } from "@/lib/navigation";
import { hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
import { StatusTag } from "@/components/status-tag";

const { Text } = Typography;

const INVOICE_TYPE_OPTIONS = [
  { value: "VAT_SPECIAL", label: "增值税专用发票" },
  { value: "VAT_GENERAL", label: "增值税普通发票" },
  { value: "VAT_ELECTRONIC", label: "增值税电子专票" },
  { value: "ELEC_NORMAL", label: "电子普通发票" }
];

const TITLE_TYPE_OPTIONS = [
  { value: "COMPANY", label: "公司" },
  { value: "PERSONAL", label: "个人" }
];

export default function EditInvoicePage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack(`/invoices/${id}`);
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [form] = ProForm.useForm();
  const { data, isLoading, mutate } = useSWR<InvoiceEntity>(`/api/invoices/${id}`);
  // 抬头类型 state — 所有 hooks 必须在 early return 之前, 否则违反 rules-of-hooks
  const [titleType, setTitleType] = useState<"COMPANY" | "PERSONAL">("COMPANY");
  useEffect(() => {
    if (data?.titleType === "PERSONAL" || data?.titleType === "COMPANY") {
      setTitleType(data.titleType);
    }
  }, [data?.titleType]);

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={goBack} title="编辑开票" />
        <FormPageSkeleton />
      </Page>
    );
  }

  // 服务端 resolveAttachmentSnapshots 会按 id 回查 DB 并重写 uploadedBy / uploadedAt,
  // 这里仍然把原值带上, 与 contracts/[id]/edit 对齐, 避免 snapshot 与 DB 失同步
  // 权限: SALES/EXPERT/FINANCE/ADMIN 都有 INVOICE UPDATE (DRAFT 或 admin), OPS 没有
  // roleCode 在 session 未就绪时为 undefined, 用 ?? 兜底, OPS 兜底成 "" 后 hasPermission 返回 false
  const roleCode = (session?.user?.roleCode ?? "") as Parameters<typeof hasPermission>[0];
  const isAdmin = roleCode === "ADMIN";
  const canUpdate = hasPermission(roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  if (!canUpdate) {
    return (
      <Page compact>
        <PageHeader back={goBack} title="编辑开票" />
        <FormCard>
          <Text type="warning">当前角色无开票编辑权限, 仅可查看。如需修改请联系财务或管理员。</Text>
        </FormCard>
      </Page>
    );
  }
  // 非 admin 撞上非 DRAFT: 直接挡住, 与后端 updateInvoice 守卫一致
  if (!isAdmin && data.status !== "DRAFT") {
    return (
      <Page compact>
        <PageHeader
          back={goBack}
          title="编辑开票"
          meta={<StatusTag status={data.status} domain="invoice" />}
        />
        <FormCard>
          <Text type="warning">
            当前状态 <StatusTag status={data.status} domain="invoice" /> 不可编辑;仅 草稿 可改。
          </Text>
        </FormCard>
      </Page>
    );
  }

  const existingAttachments: AttachmentSnapshot[] = ((data.attachments ?? []) as Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    uploadedBy: string;
    uploadedAt: string;
    url: string | null;
  }>).map((a) => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
    url: a.url ?? undefined
  }));
  const existingAttachmentItems: AttachmentItem[] = existingAttachments.map((a) => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    legacyUrl: a.url ?? undefined
  }));

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="编辑开票"
        subtitle="修改发票号/金额/税率/抬头信息等字段;合同与状态不可改"
        meta={<StatusTag status={data.status} domain="invoice" />}
      />
      <FormCard headerHint={`已选合同:${data.contractNo ?? data.contractId} · 客户:${data.customerName}。合同一旦绑定不可更换。`}>
        <ProForm
          submitter={false}
          formRef={formRef}
          form={form}
          layout="vertical"
          initialValues={{
            invoiceNo: data.invoiceNo ?? undefined,
            invoiceType: data.invoiceType,
            amount: data.amount ? Number(data.amount) : undefined,
            taxRate: data.taxRate != null ? Number(data.taxRate) : 0.06,
            applyDate: data.applyDate ? dayjs(data.applyDate) : undefined,
            expectedIssueDate: data.expectedIssueDate ? dayjs(data.expectedIssueDate) : undefined,
            titleType: data.titleType,
            titleName: data.titleName,
            taxNo: data.taxNo ?? undefined,
            bankName: data.bankName ?? undefined,
            bankAccount: data.bankAccount ?? undefined,
            address: data.address ?? undefined,
            phone: data.phone ?? undefined,
            remark: data.remark ?? undefined
          }}
          onFinish={async (values) => {
            const existing = existingAttachments.map((a) => ({
              id: a.id,
              name: a.name,
              mimeType: a.mimeType,
              size: a.size,
              uploadedBy: a.uploadedBy,
              uploadedAt: a.uploadedAt
            }));
            const newlyUploaded = (values.attachments ?? [])
              .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
              .filter((r: { id?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id));
            const merged = [...existing, ...newlyUploaded];
            const payload = {
              ...values,
              applyDate: values.applyDate ? dayjs(values.applyDate).toISOString() : undefined,
              expectedIssueDate: values.expectedIssueDate ? dayjs(values.expectedIssueDate).toISOString() : undefined,
              attachments: merged
            };
            delete (payload as Record<string, unknown>).attachments_uploads;
            const res = await fetch(`/api/invoices/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("开票已保存");
            await mutate();
            router.push(`/invoices/${id}`);
            return true;
          }}
        >
          <FormSection title="关联合同" description="合同一旦绑定不可更换;如需变更请新建开票">
            <FormGrid columns={1}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>合同编号:</Text>
                <Text copyable>{data.contractNo ?? data.contractId}</Text>
                <Tag style={{ marginLeft: 8 }} color="blue">只读</Tag>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>客户:</Text>
                <Text copyable>{data.customerName}</Text>
              </div>
            </FormGrid>
          </FormSection>

          <FormSection title="发票信息">
            <FormGrid columns={1}>
              <ProFormText
                name="invoiceNo"
                label="发票号"
                placeholder="如:01100210031112345678(电子发票为 20 位数字)"
                rules={[
                  { required: true, message: "请输入发票号(电子发票为 20 位数字)" },
                  { min: 1, max: 50 }
                ]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormSelect
                name="invoiceType"
                label="发票类型"
                options={INVOICE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择发票类型(必填)" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="titleType"
                label="抬头类型"
                options={TITLE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择抬头类型(必填)" }]}
                fieldProps={{
                  size: "large",
                  onChange: (v) => setTitleType((v as "COMPANY" | "PERSONAL") ?? "COMPANY")
                }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormDigit
                name="amount"
                label="含税金额"
                min={0.01}
                rules={[{ required: true, message: "请输入含税金额(必填)" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormSelect
                name="taxRate"
                label="税率"
                options={TAX_RATE_OPTIONS.map((v, i) => ({ value: v, label: TAX_RATE_LABELS[i] }))}
                rules={[{ required: true, message: "请选择适用税率(必填)" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormDatePicker
                name="applyDate"
                label="申请日期"
                rules={[{ required: true, message: "请选择开票申请日期(必填)" }]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
              <ProFormDatePicker
                name="expectedIssueDate"
                label="预计开票日"
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="抬头信息"
            description={
              titleType === "COMPANY"
                ? "公司抬头:抬头名称必填;税号、开户行、银行账号、地址、电话均选填"
                : "个人抬头:抬头名称必填;税号、开户行、银行账号均选填"
            }
          >
            <FormGrid columns={1}>
              <ProFormText
                name="titleName"
                label="抬头名称"
                rules={[{ required: true, max: 100 }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormText
                name="taxNo"
                label="税号"
                placeholder={titleType === "COMPANY" ? "如:91330100MA0XXXXXXX(18 位)" : "个人抬头无需税号, 可空"}
                fieldProps={{ size: "large", maxLength: 30 }}
              />
              <ProFormText
                name="bankName"
                label="开户行"
                placeholder="如:工商银行杭州武林支行(选填)"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="bankAccount"
                label="银行账号"
                placeholder="请输入对公账号(选填)"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="address"
                label="地址"
                placeholder={data.address ? `已填:${data.address}` : "请输入公司注册地址或开票地址"}
                fieldProps={{ size: "large", maxLength: 200 }}
              />
              <ProFormText
                name="phone"
                label="电话"
                placeholder={data.phone ?? "如:13800001111 (选填)"}
                fieldProps={{ size: "large", maxLength: 20 }}
              />
            </FormGrid>
            <FormGrid columns={1}>
              <ProFormTextArea
                name="remark"
                label="备注"
                placeholder="如:特殊开票要求、对方收件信息等 (选填)"
                fieldProps={{ size: "large", maxLength: 500, autoSize: { minRows: 2, maxRows: 6 } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="支持凭证"
            description="电子发票 PDF、银行回单等凭证;可继续追加上传,保存后与发票绑定"
          >
            <FormGrid columns={1}>
              <AttachmentList
                items={existingAttachmentItems}
                onDeleted={() => mutate()}
              />
              <UploadButton
                name="attachments"
                label="追加附件"
                max={5}
                fieldProps={{
                  name: "file",
                  // 编辑阶段 invoiceId 已存在,直传绑到该发票
                  customRequest: proCustomRequest({ invoiceId: id })
                }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              草稿状态可改;保存后仍是 <Tag color="blue">草稿</Tag>,可在详情页提交审核。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => goBack}
            submitText="保存开票"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
