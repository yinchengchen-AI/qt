"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormText, ProFormSelect, ProFormDigit, ProFormDateTimePicker, ProFormUploadButton } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";
import { useSession } from "next-auth/react";

export default function NewContractPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const serviceType = useDict("SERVICE_TYPE");
  const { data: customersData } = useSWR<{ list: any[] }>(session?.user ? "/api/customers?pageSize=100" : null);
  const customerOptions = (customersData?.list ?? [])
    .filter((c) => ["NEGOTIATING", "SIGNED"].includes(c.status))
    .map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));

  return (
    <Page compact>
      <PageHeader back={() => router.push("/contracts")} title="新建合同" subtitle="为洽谈中或已签约客户创建合同,提交后进入审批" />
      <ProCard>
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          const payload = {
            ...values,
            signDate: values.signDate?.toISOString?.() ?? values.signDate,
            startDate: values.startDate?.toISOString?.() ?? values.startDate,
            endDate: values.endDate?.toISOString?.() ?? values.endDate,
            attachments: (values.attachments ?? []).map((f: any, i: number) => ({
              id: `att-${Date.now()}-${i}`,
              name: f.name,
              url: f.url ?? "https://placeholder.local/" + f.name,
              mimeType: f.type ?? "application/octet-stream",
              size: f.size ?? 0,
              uploadedBy: session?.user?.id ?? "unknown",
              uploadedAt: new Date().toISOString()
            }))
          };
          const res = await fetch("/api/contracts", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已创建（草稿）");
          router.push(`/contracts/${j.data.id}`);
          return true;
        }}
      >
        <ProFormSelect name="customerId" label="客户" options={customerOptions} rules={[{ required: true, message: "请选择客户（仅 NEGOTIATING/SIGNED 状态可选）" }]} showSearch />
        <ProFormText name="title" label="合同标题" rules={[{ required: true }, { min: 2, max: 200 }]} />
        <ProFormSelect name="serviceType" label="服务类型" options={serviceType.map((d) => ({ value: d.code, label: d.label }))} rules={[{ required: true }]} />
        <ProFormDateTimePicker name="signDate" label="签订日期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="startDate" label="服务起期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="endDate" label="服务止期" rules={[{ required: true }]} />
        <ProFormDigit name="totalAmount" label="合同总额（含税，元）" min={0.01} rules={[{ required: true }]} fieldProps={{ precision: 2, prefix: "¥" }} />
        <ProFormDigit name="taxRate" label="税率" min={0} max={1} initialValue={0.06} fieldProps={{ precision: 4 }} />
        <ProFormSelect name="paymentMethod" label="付款方式" rules={[{ required: true }]} options={[
          { value: "LUMP_SUM", label: "一次性" }, { value: "BY_PHASE", label: "按阶段" },
          { value: "BY_MONTH", label: "按月" }, { value: "BY_QUARTER", label: "按季" }
        ]} />
        <ProFormUploadButton name="attachments" label="合同附件" tooltip="至少 1 个盖章 PDF 后才能提交审批" max={5} fieldProps={{ name: "file" }} />
        <Button type="primary" htmlType="submit">保存草稿</Button>
      </ProForm>
    </ProCard>
    </Page>
  );
}
