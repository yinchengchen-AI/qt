"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormText, ProFormSelect, ProFormDigit, ProFormDateTimePicker } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";

export default function EditContractPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<any>(`/api/contracts/${id}`);
  const serviceType = useDict("SERVICE_TYPE");
  if (isLoading || !data) return <Page compact><EmptyState loading /></Page>;
  if (!["DRAFT", "PENDING_REVIEW"].includes(data.status)) return <ProCard>当前状态不可编辑</ProCard>;
  return (
    <Page compact>
      <PageHeader back={() => router.push(`/contracts/${id}`)} title="编辑合同" subtitle="草稿或待审批状态可编辑" />
      <ProCard>
      <ProForm
        layout="vertical"
        initialValues={{
          ...data,
          signDate: data.signDate ? new Date(data.signDate) : undefined,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          endDate: data.endDate ? new Date(data.endDate) : undefined
        }}
        onFinish={async (values) => {
          const payload = {
            ...values,
            signDate: values.signDate?.toISOString?.(),
            startDate: values.startDate?.toISOString?.(),
            endDate: values.endDate?.toISOString?.()
          };
          const res = await fetch(`/api/contracts/${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已保存"); router.push(`/contracts/${id}`); return true;
        }}
      >
        <ProFormText name="title" label="合同标题" rules={[{ required: true }]} />
        <ProFormSelect name="serviceType" label="服务类型" options={serviceType.map((d) => ({ value: d.code, label: d.label }))} rules={[{ required: true }]} />
        <ProFormDateTimePicker name="signDate" label="签订日期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="startDate" label="服务起期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="endDate" label="服务止期" rules={[{ required: true }]} />
        <ProFormDigit name="totalAmount" label="合同总额（含税）" min={0.01} rules={[{ required: true }]} fieldProps={{ precision: 2, prefix: "¥" }} />
        <ProFormDigit name="taxRate" label="税率" min={0} max={1} fieldProps={{ precision: 4 }} />
        <ProFormSelect name="paymentMethod" label="付款方式" options={[
          { value: "LUMP_SUM", label: "一次性" }, { value: "BY_PHASE", label: "按阶段" },
          { value: "BY_MONTH", label: "按月" }, { value: "BY_QUARTER", label: "按季" }
        ]} />
      </ProForm>
    </ProCard>
    </Page>
  );
}
