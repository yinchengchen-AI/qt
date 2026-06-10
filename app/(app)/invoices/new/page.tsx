"use client";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Card, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";

const { Text } = Typography;

const INVOICE_TYPE_OPTIONS = [
  { value: "VAT_SPECIAL", label: "增值税专用发票" },
  { value: "VAT_GENERAL", label: "增值税普通发票" },
  { value: "VAT_ELECTRONIC", label: "增值税电子专票" },
  { value: "ELEC_NORMAL", label: "电子普通发票" }
];

const TITLE_TYPE_OPTIONS = [
  { value: "COMPANY", label: "公司" },
  { value: "PERSONAL", label: "个人" }
];

type Project = {
  id: string;
  projectNo: string;
  name: string;
  status: string;
  contract?: {
    id: string;
    contractNo: string;
    customerId: string;
    customerName: string;
  };
};

type Customer = {
  id: string;
  name: string;
  contactPhone: string;
  contactEmail: string | null;
  address: string | null;
};

export default function NewInvoicePage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [titleType, setTitleType] = useState<"COMPANY" | "PERSONAL">("COMPANY");

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/invoices")}
        title="新建开票"
        subtitle="为已签约项目申请开票,提交后由财务审核"
      />
      <FormCard
        headerHint={
          pickedCustomer
            ? `已选客户：${pickedCustomer.name}。抬头名称自动锁定为客户全称,可手动改。`
            : "选项目后会带出关联客户;抬头信息按公司/个人区分字段"
        }
      >
        <ProForm
          layout="vertical"
          initialValues={{
            invoiceType: "VAT_SPECIAL",
            taxRate: 0.06,
            applyDate: new Date(),
            titleType: "COMPANY"
          }}
          onFinish={async (values) => {
            const payload = {
              ...values,
              applyDate: values.applyDate?.toISOString?.(),
              expectedIssueDate: values.expectedIssueDate?.toISOString?.()
            };
            const res = await fetch("/api/invoices", {
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
            message.success("已创建草稿");
            router.push(`/invoices/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="关联项目" description="仅 PLANNED / IN_PROGRESS / SUSPENDED / DELIVERED / ACCEPTED 状态可开票">
            <ProFormSelect
              name="projectId"
              label="项目"
              placeholder="搜索项目编号 / 名称"
              showSearch
              rules={[{ required: true, message: "请选择项目" }]}
              fieldProps={{ size: "large", optionFilterProp: "label" }}
              request={async (params: { keyWords?: string }) => {
                const qs = new URLSearchParams();
                qs.set("pageSize", "50");
                qs.set("keyword", params.keyWords ?? "");
                const r = await fetch(`/api/projects?${qs}`, { credentials: "include" });
                const j = await r.json();
                if (j.code !== 0) return [];
                return (j.data.list as Project[])
                  .filter((p) =>
                    ["PLANNED", "IN_PROGRESS", "SUSPENDED", "DELIVERED", "ACCEPTED"].includes(p.status)
                  )
                  .map((p) => ({
                    value: p.id,
                    label: `${p.projectNo} · ${p.name}`,
                    customerId: p.contract?.customerId,
                    customerName: p.contract?.customerName
                  }));
              }}
              onChange={async (
                _: unknown,
                opt: { customerId?: string; customerName?: string } | unknown
              ) => {
                const o = opt as { customerId?: string } | undefined;
                if (!o?.customerId) {
                  setPickedCustomer(null);
                  return;
                }
                try {
                  const r = await fetch(`/api/customers/${o.customerId}`, {
                    credentials: "include"
                  });
                  const j = await r.json();
                  if (j.code === 0) setPickedCustomer(j.data as Customer);
                } catch {
                  /* ignore */
                }
              }}
            />
          </FormSection>

          <FormSection title="发票信息">
            <FormGrid columns={2}>
              <ProFormSelect
                name="invoiceType"
                label="发票类型"
                options={INVOICE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择发票类型" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="titleType"
                label="抬头类型"
                options={TITLE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择抬头类型" }]}
                fieldProps={{
                  size: "large",
                  onChange: (v) => setTitleType(v as "COMPANY" | "PERSONAL")
                }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormDigit
                name="amount"
                label="含税金额"
                min={0.01}
                rules={[{ required: true, message: "请输入含税金额" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormDigit
                name="taxRate"
                label="税率"
                min={0}
                max={1}
                initialValue={0.06}
                fieldProps={{ size: "large", precision: 4, step: 0.01 }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormDatePicker
                name="applyDate"
                label="申请日期"
                rules={[{ required: true, message: "请选择申请日期" }]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
              <ProFormDatePicker
                name="expectedIssueDate"
                label="预计开票日"
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="抬头信息"
            description={
              titleType === "COMPANY"
                ? "公司抬头:抬头名称 + 税号必填;银行 / 地址 / 电话选填"
                : "个人抬头:抬头名称必填;税号 / 银行等选填"
            }
          >
            <FormGrid columns={1}>
              <ProFormText
                name="titleName"
                label="抬头名称"
                placeholder={
                  pickedCustomer
                    ? `默认：${pickedCustomer.name}(可改)`
                    : "如:杭州阿里巴巴有限公司"
                }
                rules={[{ required: true, max: 100 }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormText
                name="taxNo"
                label="税号"
                placeholder={titleType === "COMPANY" ? "如:91330100XXXX(18 位)" : "可空"}
                rules={
                  titleType === "COMPANY"
                    ? [{ required: true, message: "公司抬头必填税号" }]
                    : undefined
                }
                fieldProps={{ size: "large", maxLength: 30 }}
              />
              <ProFormText
                name="bankName"
                label="开户行"
                placeholder="如:工商银行杭州武林支行"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="bankAccount"
                label="银行账号"
                placeholder="对公账号"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="address"
                label="地址"
                placeholder={
                  pickedCustomer?.address
                    ? `默认：${pickedCustomer.address}`
                    : "公司注册地址或开票地址"
                }
                fieldProps={{ size: "large", maxLength: 200 }}
              />
              <ProFormText
                name="phone"
                label="电话"
                placeholder={pickedCustomer?.contactPhone ?? "可空"}
                fieldProps={{ size: "large", maxLength: 20 }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              草稿状态可编辑;提交后 <Tag color="blue">DRAFT → PENDING_FINANCE</Tag> 由财务审核。
            </Text>
          </Space>
        </ProForm>
      </FormCard>
    </Page>
  );
}
