"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormText, ProFormTextArea, ProFormSelect, ProFormDigit, ProFormDateTimePicker } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";

export default function NewProjectPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: contractsData } = useSWR<{ list: any[] }>("/api/contracts?pageSize=100");
  const options = (contractsData?.list ?? [])
    .filter((c) => ["EFFECTIVE", "EXECUTING"].includes(c.status))
    .map((c) => ({ value: c.id, label: `${c.contractNo} · ${c.title}` }));

  return (
    <Page compact>
      <PageHeader back={() => router.push("/projects")} title="新建项目" subtitle="从已生效合同拆解出可执行项目" />
      <ProCard>
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          const payload = {
            ...values,
            startDate: values.startDate?.toISOString?.(),
            endDate: values.endDate?.toISOString?.()
          };
          const res = await fetch("/api/projects", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已创建"); router.push(`/projects/${j.data.id}`); return true;
        }}
      >
        <ProFormSelect name="contractId" label="所属合同" options={options} showSearch rules={[{ required: true, message: "仅 EFFECTIVE/EXECUTING 状态的合同可选" }]} />
        <ProFormText name="name" label="项目名称" rules={[{ required: true }, { max: 100 }]} />
        <ProFormTextArea name="serviceScope" label="服务范围" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="startDate" label="起期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="endDate" label="止期" rules={[{ required: true }]} tooltip="不能晚于所属合同止期" />
        <ProFormDigit name="budgetAmount" label="预算（元）" min={0} fieldProps={{ precision: 2, prefix: "¥" }} />
        <Button type="primary" htmlType="submit">保存</Button>
      </ProForm>
    </ProCard>
    </Page>
  );
}
