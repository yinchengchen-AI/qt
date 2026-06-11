"use client";

import { useRef } from "react";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker,
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Typography } from "antd";
import { StatusTag } from "@/components/status-tag";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { proCustomRequest } from "@/lib/upload-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "LUMP_SUM", label: "一次性" },
  { value: "BY_PHASE", label: "按阶段" },
  { value: "BY_MONTH", label: "按月" },
  { value: "BY_QUARTER", label: "按季" }
];

export default function EditContractPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const formRef = useRef<any>(null);
  const { data, isLoading } = // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edit page reads many dynamic fields
  useSWR<any>(`/api/contracts/${id}`);
  const serviceType = useDict("SERVICE_TYPE");

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/contracts/${id}`)} title="编辑合同" />
        <FormPageSkeleton />
      </Page>
    );
  }

  if (!["DRAFT", "PENDING_REVIEW"].includes(data.status)) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/contracts/${id}`)} title="编辑合同" />
        <FormCard>
          <Text type="warning">
            当前状态 <StatusTag status={data.status} domain="contract" /> 不可编辑;仅 草稿 / 待审批 可改。
          </Text>
        </FormCard>
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/contracts/${id}`)}
        title="编辑合同"
        subtitle="客户不可改;服务起止期可改,止期必须晚于起期"
      />
      <FormCard headerHint={`客户：${data.customerName}（${data.customerId}）。客户一旦签约不可更换,如需换客户请新建合同。`}>
        <ProForm
          submitter={false}
          formRef={formRef}
          layout="vertical"
          initialValues={{
            title: data.title,
            serviceType: data.serviceType,
            paymentMethod: data.paymentMethod,
            signDate: data.signDate ? new Date(data.signDate) : undefined,
            startDate: data.startDate ? new Date(data.startDate) : undefined,
            endDate: data.endDate ? new Date(data.endDate) : undefined,
            totalAmount: data.totalAmount ? Number(data.totalAmount) : undefined,
            taxRate: data.taxRate ? Number(data.taxRate) : 0.06
          }}
          onFinish={async (values) => {
            // 新上传的(从 ProFormUploadButton):[{ uid, name, status, response: { id, ... } }]
            // 与已有(data.attachments)合并,一起发给后端
            const existing = (data.attachments ?? []) as Array<{ id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string }>;
            const newlyUploaded = (values.attachments ?? [])
              .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
              .filter((r: { id?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id));
            const merged = [...existing, ...newlyUploaded];
            const payload = {
              ...values,
              signDate: values.signDate?.toISOString?.(),
              startDate: values.startDate?.toISOString?.(),
              endDate: values.endDate?.toISOString?.(),
              attachments: merged
            };
            delete (payload as Record<string, unknown>).attachments_uploads;
            const res = await fetch(`/api/contracts/${id}`, {
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
            message.success("已保存");
            router.push(`/contracts/${id}`);
            return true;
          }}
        >
          <FormSection title="合同信息">
            <FormGrid columns={1}>
              <ProFormText
                name="title"
                label="合同标题"
                rules={[
                  { required: true, message: "请输入合同标题" },
                  { min: 2, max: 200 }
                ]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormSelect
                name="serviceType"
                label="服务类型"
                options={serviceType.map((d) => ({ value: d.code, label: d.label }))}
                showSearch
                rules={[{ required: true, message: "请选择服务类型" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="paymentMethod"
                label="付款方式"
                options={PAYMENT_METHOD_OPTIONS}
                rules={[{ required: true, message: "请选择付款方式" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="服务期">
            <FormGrid columns={3}>
              <ProFormDatePicker name="signDate" label="签订日期" rules={[{ required: true }]} fieldProps={{ size: "large", style: { width: "100%" } }} />
              <ProFormDatePicker name="startDate" label="服务起期" rules={[{ required: true }]} fieldProps={{ size: "large", style: { width: "100%" } }} />
              <ProFormDatePicker
                name="endDate"
                label="服务止期"
                rules={[
                  { required: true, message: "请选择服务止期" },
                  ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
                    validator(_: unknown, value: unknown) {
                      const start = getFieldValue("startDate") as string | number | Date | null | undefined;
                      if (!value || !start) return Promise.resolve();
                      const d = new Date(value as string | number | Date);
                      const s = new Date(start);
                      if (Number.isNaN(d.getTime()) || Number.isNaN(s.getTime())) return Promise.resolve();
                      if (d.getTime() <= s.getTime()) {
                        return Promise.reject(new Error("服务止期必须晚于起期"));
                      }
                      return Promise.resolve();
                    }
                  })
                ]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="金额与税率">
            <FormGrid columns={2}>
              <ProFormDigit
                name="totalAmount"
                label="合同总额（含税）"
                min={0.01}
                rules={[{ required: true, message: "请输入合同总额" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormDigit
                name="taxRate"
                label="税率"
                min={0}
                max={1}
                fieldProps={{ size: "large", precision: 4, step: 0.01 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="合同附件" description="可继续添加;已有附件的删除请到详情页操作">
            <FormGrid columns={1}>
              <AttachmentList
                items={(data.attachments ?? []) as AttachmentItem[]}
                allowDelete={false}
                showHeader={false}
              />
              <UploadButton
                name="attachments"
                label="新增附件"
                max={5}
                fieldProps={{
                  name: "file",
                  customRequest: proCustomRequest({ contractId: id })
                }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              客户不可更换,合同编号不可改;如需大改建议作废当前合同后新建。
            </Text>
          </Space>
        </ProForm>
      </FormCard>
    </Page>
  );
}
