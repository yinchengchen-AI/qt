"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProCard, ProForm, ProFormDigit, ProFormDateTimePicker, ProFormSelect, ProFormText } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

export default function NewPaymentPage() {
  const router = useRouter();
  const search = useSearchParams();
  const presetContract = search.get("contractId") ?? undefined;
  const presetInvoice = search.get("invoiceId") ?? undefined;
  const { message } = AntdApp.useApp();
  const { data: contractsData } = useSWR<{ list: any[] }>("/api/contracts?pageSize=100");
  const contractOptions = (contractsData?.list ?? [])
    .filter((c) => ["EFFECTIVE", "EXECUTING", "COMPLETED"].includes(c.status))
    .map((c) => ({ value: c.id, label: `${c.contractNo} · ${c.title}` }));

  return (
    <Page compact>
      <PageHeader back={() => router.push("/payments")} title="登记回款" subtitle="登记银行到账流水,与发票 / 合同自动对账" />
      <ProCard>
      <ProForm
        layout="vertical"
        submitter={false}
        initialValues={{
          contractId: presetContract,
          invoiceId: presetInvoice,
          receivedAt: new Date(),
          method: "BANK_TRANSFER"
        }}
        onFinish={async (values) => {
          const payload = { ...values, receivedAt: values.receivedAt?.toISOString?.() };
          const res = await fetch("/api/payments", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (j.code !== 0) { message.error(j.message); return false; }
          message.success("已登记（PLANNED）"); router.push(`/payments/${j.data.id}`); return true;
        }}
      >
        <ProFormSelect name="contractId" label="合同" options={contractOptions} showSearch rules={[{ required: true }]} />
        <ProFormText name="invoiceId" label="发票 ID（可选）" tooltip="可空，留空表示合同预收款" />
        <ProFormDigit name="amount" label="金额（元）" rules={[{ required: true }]} fieldProps={{ precision: 2, prefix: "¥" }} />
        <ProFormDateTimePicker name="receivedAt" label="到账日" rules={[{ required: true }]} />
        <ProFormSelect name="method" label="收款方式" rules={[{ required: true }]} options={[
          { value: "BANK_TRANSFER", label: "银行转账" }, { value: "CHECK", label: "支票" },
          { value: "CASH", label: "现金" }, { value: "WECHAT", label: "微信" },
          { value: "ALIPAY", label: "支付宝" }, { value: "OTHER", label: "其他" }
        ]} />
        <ProFormText name="bankRefNo" label="银行流水号" tooltip="CONFIRMED 时必填；全局唯一" />
        <ProFormText name="bankName" label="收款行" />
        <ProFormText name="remark" label="备注" />
        <Button type="primary" htmlType="submit">保存</Button>
      </ProForm>
    </ProCard>
    </Page>
  );
}
