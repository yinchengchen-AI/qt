"use client";
import { ProCard, ProForm, ProFormText, ProFormSelect, ProFormDigit } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter } from "next/navigation";
import { useDict } from "@/lib/dict-client";

const STATUS = [
  { value: "LEAD", label: "线索" },
  { value: "NEGOTIATING", label: "洽谈中" },
  { value: "SIGNED", label: "已签约" },
  { value: "LOST", label: "已流失" }
];

export default function NewCustomerPage() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");

  return (
    <ProCard title={<span onClick={() => router.back()} style={{ cursor: "pointer" }}>← 新建客户</span>}>
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          const res = await fetch("/api/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(values)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("创建成功");
          router.push(`/customers/${j.data.id}`);
          return true;
        }}
      >
        <ProFormText name="name" label="客户全称" rules={[{ required: true }, { min: 2, max: 100 }]} />
        <ProFormText name="shortName" label="简称" />
        <ProFormText name="unifiedSocialCreditCode" label="统一社会信用代码" tooltip="18 位；可空；非空时需通过 GB 32100-2015 加权校验" />
        <ProFormSelect name="customerType" label="客户类型" options={customerType.map((d) => ({ value: d.code, label: d.label }))} rules={[{ required: true }]} />
        <ProFormSelect name="level" label="客户等级" initialValue="C" options={customerLevel.map((d) => ({ value: d.code, label: d.label }))} />
        <ProFormText name="industry" label="行业" />
        <ProFormText name="province" label="省份" rules={[{ required: true }]} />
        <ProFormText name="city" label="城市" rules={[{ required: true }]} />
        <ProFormText name="address" label="详细地址" />
        <ProFormText name="contactPhone" label="联系电话" rules={[{ required: true }]} />
        <ProFormText name="contactEmail" label="邮箱" />
        <ProFormText name="sourceChannel" label="客户来源" />
        <ProFormDigit name="creditLimitAmount" label="授信额度（元）" min={0} />
        <ProFormDigit name="paymentTermDays" label="账期（天）" initialValue={30} min={0} max={365} />
        <ProFormSelect name="status" label="初始状态" options={STATUS} initialValue="LEAD" />
        <Button type="primary" htmlType="submit">保存</Button>
      </ProForm>
    </ProCard>
  );
}
