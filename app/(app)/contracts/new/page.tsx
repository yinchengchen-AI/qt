"use client";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker,
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useDict } from "@/lib/dict-client";
import { proCustomRequest } from "@/lib/upload-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "LUMP_SUM", label: "一次性" },
  { value: "BY_PHASE", label: "按阶段" },
  { value: "BY_MONTH", label: "按月" },
  { value: "BY_QUARTER", label: "按季" }
];

type Customer = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  status: string;
  contactPhone: string;
  contactEmail: string | null;
  paymentTermDays: number;
  creditLimitAmount: string | null;
};

export default function NewContractPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const serviceType = useDict("SERVICE_TYPE");

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/contracts")}
        title="新建合同"
        subtitle="为洽谈中或已签约客户创建合同,提交后进入审批"
      />
      <FormCard headerHint="选客户后会自动带出联系电话 / 邮箱 / 账期;服务止期必须晚于起期,建议不少于 30 天">
        <ProForm
          layout="vertical"
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存草稿" },
            resetButtonProps: { style: { display: "none" } }
          }}
          onFinish={async (values) => {
            const payload = {
              ...values,
              signDate: values.signDate?.toISOString?.() ?? values.signDate,
              startDate: values.startDate?.toISOString?.() ?? values.startDate,
              endDate: values.endDate?.toISOString?.() ?? values.endDate,
              // attachments: 来自 ProFormUploadButton 的 customRequest 上传结果
              // 元素形状:{ uid, name, status, response: { id, name, mimeType, size, uploadedBy, uploadedAt } }
              attachments: (values.attachments ?? [])
                .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
                .filter((r: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id))
            };
            const res = await fetch("/api/contracts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("已创建（草稿）");
            router.push(`/contracts/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="签约主体" description="只可选 洽谈中 / 已签约 状态客户">
            <FormGrid columns={1}>
              <ProFormSelect
                name="customerId"
                label="客户"
                placeholder="搜索客户名 / 编号"
                showSearch
                rules={[
                  { required: true, message: "请选择客户" }
                ]}
                fieldProps={{
                  size: "large",
                  optionFilterProp: "label"
                }}
                request={async (params: { keyWords?: string }) => {
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "50");
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/customers?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return (j.data.list as Customer[])
                    .filter((c) => ["NEGOTIATING", "SIGNED"].includes(c.status))
                    .map((c) => ({
                      value: c.id,
                      label: `${c.code} · ${c.name}`,
                      // 业务字段,回填到其它字段
                      contactPhone: c.contactPhone,
                      contactEmail: c.contactEmail,
                      paymentTermDays: c.paymentTermDays
                    }));
                }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="合同信息">
            <FormGrid columns={1}>
              <ProFormText
                name="title"
                label="合同标题"
                placeholder="如:杭州阿里巴巴 2026 年安全咨询服务合同"
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
                placeholder="请选择"
                options={serviceType.map((d) => ({ value: d.code, label: d.label }))}
                rules={[{ required: true, message: "请选择服务类型" }]}
                showSearch
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="paymentMethod"
                label="付款方式"
                placeholder="请选择"
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
                placeholder="0.00"
                min={0.01}
                rules={[{ required: true, message: "请输入合同总额" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormDigit
                name="taxRate"
                label="税率"
                placeholder="0.06 表示 6%"
                min={0}
                max={1}
                initialValue={0.06}
                fieldProps={{ size: "large", precision: 4, step: 0.01 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="合同附件" description="至少 1 个盖章 PDF 后才能提交审批">
            <UploadButton
              name="attachments"
              label="上传"
              max={5}
              fieldProps={{
                name: "file",
                customRequest: proCustomRequest()
              }}
            />
          </FormSection>

          <Space style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              草稿状态可编辑;提交审批后 <Tag color="blue">草稿 → 待审批</Tag> 不可直接改,需撤回。
            </Text>
          </Space>
        </ProForm>
      </FormCard>
    </Page>
  );
}
