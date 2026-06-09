"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormText, ProFormSelect, ProFormDigit, ProFormDateTimePicker } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";

export default function NewInvoicePage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: projectsData } = useSWR<{ list: any[] }>("/api/projects?pageSize=200");
  const projectOptions = (projectsData?.list ?? [])
    .filter((p) => ["PLANNED", "IN_PROGRESS", "SUSPENDED", "DELIVERED", "ACCEPTED"].includes(p.status))
    .map((p) => ({ value: p.id, label: `${p.projectNo} · ${p.name}` }));

  return (
    <Page compact>
      <PageHeader back={() => router.push("/invoices")} title="新建开票" subtitle="为已签约项目申请开票,提交后由财务审核" />
      <ProCard>
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          const payload = {
            ...values,
            applyDate: values.applyDate?.toISOString?.(),
            expectedIssueDate: values.expectedIssueDate?.toISOString?.()
          };
          const res = await fetch("/api/invoices", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已创建草稿"); router.push(`/invoices/${j.data.id}`); return true;
        }}
      >
        <ProFormSelect name="projectId" label="项目" options={projectOptions} showSearch rules={[{ required: true }]} />
        <ProFormSelect name="invoiceType" label="发票类型" rules={[{ required: true }]} options={[
          { value: "VAT_SPECIAL", label: "增值税专用发票" },
          { value: "VAT_GENERAL", label: "增值税普通发票" },
          { value: "VAT_ELECTRONIC", label: "增值税电子专票" },
          { value: "ELEC_NORMAL", label: "电子普通发票" }
        ]} />
        <ProFormDigit name="amount" label="含税金额（元）" min={0.01} rules={[{ required: true }]} fieldProps={{ precision: 2, prefix: "¥" }} />
        <ProFormDigit name="taxRate" label="税率" min={0} max={1} initialValue={0.06} fieldProps={{ precision: 4 }} />
        <ProFormDateTimePicker name="applyDate" label="申请日期" rules={[{ required: true }]} />
        <ProFormDateTimePicker name="expectedIssueDate" label="预计开票日" />
        <ProFormSelect name="titleType" label="抬头类型" rules={[{ required: true }]} options={[
          { value: "COMPANY", label: "公司" }, { value: "PERSONAL", label: "个人" }
        ]} />
        <ProFormText name="titleName" label="抬头名称" rules={[{ required: true }]} />
        <ProFormText name="taxNo" label="税号" tooltip="公司抬头必填" />
        <ProFormText name="bankName" label="开户行" />
        <ProFormText name="bankAccount" label="银行账号" />
        <ProFormText name="address" label="地址" />
        <ProFormText name="phone" label="电话" />
        <ProFormText name="remark" label="备注" />
        <Button type="primary" htmlType="submit">保存草稿</Button>
      </ProForm>
    </ProCard>
    </Page>
  );
}
