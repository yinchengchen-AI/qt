"use client";
import { ProCard, ProForm, ProFormText, ProFormSelect, ProFormDigit } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";

const STATUS = [
  { value: "LEAD", label: "线索" }, { value: "NEGOTIATING", label: "洽谈中" },
  { value: "SIGNED", label: "已签约" }, { value: "LOST", label: "已流失" }, { value: "FROZEN", label: "已冻结" }
];

export default function EditCustomerPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");
  const { data, isLoading } = useSWR<any>(`/api/customers/${id}`);
  if (isLoading || !data) return <ProCard>加载中…</ProCard>;
  return (
    <ProCard title={<span onClick={() => router.push(`/customers/${id}`)} style={{ cursor: "pointer" }}>← 编辑客户 · {data.name}</span>}>
      <ProForm
        layout="vertical"
        initialValues={{ ...data, creditLimitAmount: data.creditLimitAmount ? Number(data.creditLimitAmount) : undefined }}
        onFinish={async (values) => {
          const res = await fetch(`/api/customers/${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(values)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已保存"); router.push(`/customers/${id}`); return true;
        }}
      >
        <ProFormText name="name" label="客户全称" rules={[{ required: true }]} />
        <ProFormText name="shortName" label="简称" />
        <ProFormText name="unifiedSocialCreditCode" label="统一社会信用代码" />
        <ProFormSelect name="customerType" label="客户类型" options={customerType.map((d) => ({ value: d.code, label: d.label }))} rules={[{ required: true }]} />
        <ProFormSelect name="level" label="客户等级" options={customerLevel.map((d) => ({ value: d.code, label: d.label }))} />
        <ProFormText name="industry" label="行业" />
        <ProFormText name="province" label="省份" rules={[{ required: true }]} />
        <ProFormText name="city" label="城市" rules={[{ required: true }]} />
        <ProFormText name="address" label="详细地址" />
        <ProFormText name="contactPhone" label="联系电话" rules={[{ required: true }]} />
        <ProFormText name="contactEmail" label="邮箱" />
        <ProFormText name="sourceChannel" label="客户来源" />
        <ProFormDigit name="creditLimitAmount" label="授信额度（元）" min={0} />
        <ProFormDigit name="paymentTermDays" label="账期（天）" min={0} max={365} />
        <ProFormSelect name="status" label="状态" options={STATUS} />
        <Button type="primary" htmlType="submit">保存</Button>
      </ProForm>
    </ProCard>
  );
}
