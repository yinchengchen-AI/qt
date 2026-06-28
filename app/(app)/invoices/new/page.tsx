"use client";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { useRef, useState } from "react";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { proCustomRequest } from "@/lib/upload-client";
import { formatCurrency } from "@/lib/format";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { TAX_RATE_OPTIONS, TAX_RATE_LABELS } from "@/lib/validators/_shared";

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

// Customer 实际字段(name / 统一社会信用代码 / 地址 / 联系电话),
// 选合同后把这些带进抬头字段;bankName / bankAccount 在客户主数据里没有,保持空
type Customer = {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
  address: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string;
};

export default function NewInvoicePage() {
  const router = useRouter();
  const goBack = useGoBack("/invoices");
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [form] = ProForm.useForm();
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [titleType, setTitleType] = useState<"COMPANY" | "PERSONAL">("COMPANY");

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="新建开票"
        subtitle="为已生效的合同申请开票，提交后由财务审核并出具发票"
      />
      <FormCard
        headerHint={
          pickedCustomer
            ? `已选客户：${pickedCustomer.name}。抬头名称自动锁定为客户全称,可手动改。`
            : "选合同后会带出关联客户;抬头信息按公司/个人区分字段"
        }
      >
        <ProForm
          submitter={false}
          formRef={formRef}
          form={form}
          layout="vertical"
          initialValues={{
            invoiceType: "VAT_SPECIAL",
            taxRate: 0.06,
            applyDate: dayjs(),
            titleType: "COMPANY"
          }}
          onFinish={async (values) => {
            const newlyUploaded = (values.attachments ?? [])
              .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
              .filter((r: { id?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id));
            // ProFormDatePicker 在 onFinish 里 values.applyDate 可能是 dayjs 或 string (取决于 antd 内部转换),
            // 用 dayjs() 包一层兼容两种, 直接 toISOString()
            const payload = {
              ...values,
              applyDate: values.applyDate ? dayjs(values.applyDate).toISOString() : undefined,
              expectedIssueDate: values.expectedIssueDate ? dayjs(values.expectedIssueDate).toISOString() : undefined,
              attachments: newlyUploaded
            };
            delete (payload as Record<string, unknown>).attachments_uploads;
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
            message.success("开票草稿已创建，可在详情页提交审核");
            router.push(`/invoices/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="关联合同" description="仅可选「已生效」或「执行中」状态的合同；选择合同后将自动带出客户与抬头信息">
            <ProFormSelect
              name="contractId"
              label="合同"
              placeholder="按合同编号 / 合同标题搜索"
              showSearch
              rules={[{ required: true, message: "请选择关联合同（必填）" }]}
              fieldProps={{
                size: "large",
                optionFilterProp: "label",
                // 选合同 → 拉客户详情 → 写抬头字段
                onChange: async (
                  _: unknown,
                  opt: {
                    value: string;
                    contract?: {
                      id: string;
                      contractNo: string;
                      title: string;
                      totalAmount: string;
                      customerId: string;
                      customerName: string;
                    };
                  } | unknown
                ) => {
                  const o = opt as { value: string; contract?: { customerId: string } } | undefined;
                  const customerId = o?.contract?.customerId;
                  if (!customerId) {
                    setPickedCustomer(null);
                    return;
                  }
                  try {
                    const r = await fetch(`/api/customers/${customerId}`, {
                      credentials: "include"
                    });
                    const j = await r.json();
                    if (j.code !== 0) return;
                    const customer = j.data as Customer;
                    setPickedCustomer(customer);
                    // 写抬头字段:客户全称/统一社会信用代码/地址/电话
                    // bankName / bankAccount 在客户主数据里没有,不动
                    form.setFieldsValue({
                      titleName: customer.name,
                      taxNo: customer.unifiedSocialCreditCode ?? undefined,
                      address: customer.address ?? undefined,
                      phone: customer.contactPhone ?? undefined
                    });
                  } catch {
                    /* ignore */
                  }
                }
              }}
              request={async (params: { keyWords?: string }) => {
                const qs = new URLSearchParams();
                qs.set("pageSize", "1000");
                qs.set("keyword", params.keyWords ?? "");
                qs.set("status", "ACTIVE");
                const r = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
                const j = await r.json();
                if (j.code !== 0) return [];
                return (j.data.list as Array<{
                  id: string;
                  contractNo: string;
                  title: string;
                  totalAmount: string;
                  customerId: string;
                  customerName: string;
                }>).map((c) => ({
                  value: c.id,
                  label: `${c.contractNo} · ${c.title} · ${formatCurrency(c.totalAmount)}`,
                  contract: c
                }));
              }}
            />
          </FormSection>

          <FormSection title="发票信息">
            <FormGrid columns={1}>
              <ProFormText
                name="invoiceNo"
                label="发票号"
                placeholder="如：01100210031112345678（电子发票为 20 位数字）"
                rules={[
                  { required: true, message: "请输入发票号（电子发票为 20 位数字）" },
                  { min: 1, max: 50 }
                ]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormSelect
                name="invoiceType"
                label="发票类型"
                options={INVOICE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择发票类型（必填）" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="titleType"
                label="抬头类型"
                options={TITLE_TYPE_OPTIONS}
                rules={[{ required: true, message: "请选择抬头类型（必填）" }]}
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
                rules={[{ required: true, message: "请输入含税金额（必填）" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormSelect
                name="taxRate"
                label="税率"
                initialValue={0.06}
                options={TAX_RATE_OPTIONS.map((v, i) => ({ value: v, label: TAX_RATE_LABELS[i] }))}
                rules={[{ required: true, message: "请选择适用税率（必填）" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormDatePicker
                name="applyDate"
                label="申请日期"
                rules={[{ required: true, message: "请选择开票申请日期（必填）" }]}
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
                ? "公司抬头：抬头名称必填；税号、开户行、银行账号、地址、电话均选填"
                : "个人抬头：抬头名称必填；税号、开户行等均选填"
            }
          >
            <FormGrid columns={1}>
              <ProFormText
                name="titleName"
                label="抬头名称"
                placeholder={
                  pickedCustomer
                    ? `默认：${pickedCustomer.name}（可手动修改）`
                    : "如：杭州阿里巴巴有限公司"
                }
                rules={[{ required: true, max: 100 }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormText
                name="taxNo"
                label="税号"
                placeholder={titleType === "COMPANY" ? "如：91330100MA0XXXXXXX（18 位）" : "个人抬头无需税号，可空"}
                fieldProps={{ size: "large", maxLength: 30 }}
              />
              <ProFormText
                name="bankName"
                label="开户行"
                placeholder="如：工商银行杭州武林支行（选填）"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="bankAccount"
                label="银行账号"
                placeholder="请输入对公账号（选填）"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="address"
                label="地址"
                placeholder={
                  pickedCustomer?.address
                    ? `默认：${pickedCustomer.address}`
                    : "请输入公司注册地址或开票地址"
                }
                fieldProps={{ size: "large", maxLength: 200 }}
              />
              <ProFormText
                name="phone"
                label="电话"
                placeholder={pickedCustomer?.contactPhone || "如：13800001111（选填）"}
                fieldProps={{ size: "large", maxLength: 20 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="支持凭证"
            description="电子发票 PDF、银行回单等凭证（选填，先传可后改）；保存后将与发票绑定"
          >
            <FormGrid columns={1}>
              <UploadButton
                name="attachments"
                label="上传附件"
                max={5}
                fieldProps={{
                  name: "file",
                  // 新建阶段 invoiceId 尚未生成,先传 null,落到 tmp/;创建后 service 会回填 invoiceId
                  customRequest: proCustomRequest({ invoiceId: null })
                }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              草稿状态可编辑;提交后 <Tag color="blue">草稿 → 财务待审</Tag> 由财务审核。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => goBack}
            submitText="创建开票"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
