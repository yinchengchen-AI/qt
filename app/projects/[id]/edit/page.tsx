"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormText, ProFormTextArea, ProFormDateTimePicker, ProFormDigit } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";

export default function EditProjectPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<any>(`/api/projects/${id}`);
  if (isLoading || !data) return <Page compact><EmptyState loading /></Page>;
  if (!["PLANNED", "SUSPENDED"].includes(data.status)) return <ProCard>当前状态不可编辑</ProCard>;
  return (
    <Page compact>
      <PageHeader back={() => router.push(`/projects/${id}`)} title="编辑项目" subtitle="计划中或已暂停状态可编辑" />
      <ProCard>
      <ProForm
        layout="vertical"
        initialValues={{
          ...data,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          endDate: data.endDate ? new Date(data.endDate) : undefined
        }}
        onFinish={async (values) => {
          const payload = {
            ...values,
            startDate: values.startDate?.toISOString?.(),
            endDate: values.endDate?.toISOString?.()
          };
          const res = await fetch(`/api/projects/${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已保存"); router.push(`/projects/${id}`); return true;
        }}
      >
        <ProFormText name="name" label="项目名称" rules={[{ required: true }]} />
        <ProFormTextArea name="serviceScope" label="服务范围" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="startDate" label="起期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="endDate" label="止期" rules={[{ required: true }]} />
        <ProFormDigit name="budgetAmount" label="预算（元）" min={0} fieldProps={{ precision: 2, prefix: "¥" }} />
        <Button type="primary" htmlType="submit">保存</Button>
      </ProForm>
    </ProCard>
    </Page>
  );
}
