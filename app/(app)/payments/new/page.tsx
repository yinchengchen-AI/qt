"use client";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { toIsoDateTime } from "@/lib/format";
import { useRouter, useSearchParams } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { useRef, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "BANK_TRANSFER", label: "银行转账" },
  { value: "CHECK", label: "支票" },
  { value: "CASH", label: "现金" },
  { value: "WECHAT", label: "微信" },
  { value: "ALIPAY", label: "支付宝" },
  { value: "OTHER", label: "其他" }
];

type Contract = {
  id: string;
  contractNo: string;
  title: string;
  status: string;
  customerName: string;
};

type Invoice = {
  id: string;
  invoiceNo: string;
  amount: string;
  contractId: string;
  status: string;
};

export default function NewPaymentPage() {
  const router = useRouter();
  const goBack = useGoBack("/payments");
  const search = useSearchParams();
  const presetContract = search.get("contractId") ?? undefined;
  const presetInvoice = search.get("invoiceId") ?? undefined;
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [pickedContract, setPickedContract] = useState<Contract | null>(null);

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="登记回款"
        subtitle="登记银行到账流水，与发票、合同自动对账"
      />
      <FormCard
        headerHint={
          pickedContract
            ? `合同：${pickedContract.contractNo}（${pickedContract.customerName}）；选了发票后金额应与发票一致`
            : "选合同后，发票下拉会限制为同合同的可选项；留空表示合同预收款"
        }
      >
        <ProForm
          submitter={false}
          formRef={formRef}
          layout="vertical"
          initialValues={{
            contractId: presetContract,
            invoiceId: presetInvoice,
            receivedAt: dayjs(),
            method: "BANK_TRANSFER"
          }}
          onFinish={async (values) => {
            const payload = {
              ...values,
              receivedAt: toIsoDateTime(values.receivedAt)
            };
            const res = await fetch("/api/payments", {
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
            message.success("回款已登记（计划中）");
            router.push(`/payments/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="合同与发票" description="合同必填；发票选填，留空表示合同预收款">
            <FormGrid columns={2}>
              <ProFormSelect
                name="contractId"
                label="合同"
                placeholder="搜索合同号或合同标题"
                showSearch
                rules={[{ required: true, message: "请选择合同（必填）" }]}
                fieldProps={{ size: "large", optionFilterProp: "label" }}
                request={async (params: { keyWords?: string }) => {
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "1000");
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return (j.data.list as Contract[])
                    .filter((c) => c.status === "ACTIVE")
                    .map((c) => ({
                      value: c.id,
                      label: `${c.contractNo} · ${c.title}`,
                      customerName: c.customerName
                    }));
                }}
                onChange={async (
                  _: unknown,
                  opt: { value: string; customerName?: string; label: string } | unknown
                ) => {
                  const o = opt as { value: string; customerName?: string; label: string } | undefined;
                  setPickedContract(
                    o
                      ? ({ id: o.value, customerName: o.customerName ?? "" } as Contract)
                      : null
                  );
                }}
              />
              <ProFormSelect
                name="invoiceId"
                label="发票"
                placeholder={pickedContract ? "选同合同的发票；留空表示合同预收款" : "请先选择合同"}
                disabled={!presetContract && !pickedContract}
                showSearch
                allowClear
                fieldProps={{ size: "large", optionFilterProp: "label" }}
                request={async (params: { keyWords?: string }) => {
                  const cid = presetContract ?? pickedContract?.id;
                  if (!cid) return [];
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "1000");
                  qs.set("contractId", cid);
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/invoices?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return (j.data.list as Invoice[]).map((i) => ({
                    value: i.id,
                    label: `${i.invoiceNo} · ¥${i.amount}`,
                    amount: i.amount
                  }));
                }}
                onChange={(_: unknown, _opt: { amount?: string } | unknown) => undefined}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="金额与到账">
            <FormGrid columns={2}>
              <ProFormDigit
                name="amount"
                label="金额"
                min={0.01}
                rules={[{ required: true, message: "请输入金额（必填）" }]}
                fieldProps={{
                  size: "large",
                  precision: 2,
                  prefix: "¥",
                  addonAfter: "元"
                }}
              />
              <ProFormDatePicker
                name="receivedAt"
                label="到账日"
                rules={[{ required: true, message: "请选择到账日（必填）" }]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
              <ProFormSelect
                name="method"
                label="收款方式"
                options={PAYMENT_METHOD_OPTIONS}
                rules={[{ required: true, message: "请选择收款方式（必填）" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormText
                name="bankRefNo"
                label="银行流水号"
                placeholder="对账时必填；全局唯一，建议粘贴银行流水"
                tooltip="已确认状态时必填；用于后续对账"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="收款方信息">
            <FormGrid columns={2}>
              <ProFormText
                name="bankName"
                label="收款行"
                placeholder="请输入实际到账的银行名称"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="remark"
                label="备注"
                placeholder="备注信息（选填）"
                fieldProps={{ size: "large", maxLength: 200, showCount: true }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              登记后状态为「计划中」；
              财务确认后变为「已确认」，可对账。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => goBack}
            submitText="登记回款"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
