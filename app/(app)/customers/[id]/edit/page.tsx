"use client";
import {
  StepsForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";
import { useStatusOptions } from "@/lib/use-status-enum";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { RegionFields } from "@/components/form/RegionFields";
import { FormPageSkeleton } from "@/components/form-page-skeleton";

const { Text } = Typography;

const STEP_TITLES = ["基本信息", "位置与联系", "财务与等级"];

export default function EditCustomerPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const statusOptions = useStatusOptions("customer");
  const { data, isLoading } = useSWR<any>(`/api/customers/${id}`);

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader
          back={() => router.push(`/customers/${id}`)}
          title="编辑客户"
          subtitle="修改客户基础信息"
        />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/customers/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle="线索录入 → 位置与联系 → 财务与等级"
      />
      <FormCard headerHint={`客户编号 ${data.code} 不可修改;创建人 / 创建时间详见详情页`}>
        <StepsForm
          onFinish={async (values) => {
            const res = await fetch(`/api/customers/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(values)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("已保存");
            router.push(`/customers/${id}`);
            return true;
          }}
        >
          <StepsForm.StepForm
            name="base"
            title={STEP_TITLES[0]}
            initialValues={{
              name: data.name,
              shortName: data.shortName,
              customerType: data.customerType,
              level: data.level,
              industry: data.industry ?? undefined,
              sourceChannel: data.sourceChannel ?? undefined
            }}
            onFinish={async () => true}
          >
            <FormSection title="客户全称与简称">
              <FormGrid columns={1}>
                <ProFormText
                  name="name"
                  label="客户全称"
                  rules={[{ required: true, min: 2, max: 100 }]}
                  fieldProps={{ size: "large" }}
                />
                <ProFormText
                  name="shortName"
                  label="简称"
                  fieldProps={{ size: "large", maxLength: 50, showCount: true }}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="类型与等级">
              <FormGrid columns={2}>
                <ProFormSelect
                  name="customerType"
                  label="客户类型"
                  options={customerType.map((d) => ({ value: d.code, label: d.label }))}
                  rules={[{ required: true, message: "请选择客户类型" }]}
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="level"
                  label="客户等级"
                  options={customerLevel.map((d) => ({ value: d.code, label: d.label }))}
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="industry"
                  label="行业"
                  placeholder="请选择行业"
                  options={industryDict.map((d) => ({ value: d.code, label: d.label }))}
                  showSearch
                  allowClear
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="sourceChannel"
                  label="客户来源"
                  placeholder="请选择客户来源"
                  options={sourceDict.map((d) => ({ value: d.code, label: d.label }))}
                  showSearch
                  allowClear
                  fieldProps={{ size: "large" }}
                />
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>

          <StepsForm.StepForm
            name="region"
            title={STEP_TITLES[1]}
            initialValues={{
              address: data.address ?? undefined
            }}
            onFinish={async () => true}
          >
            <FormSection title="所在地区">
              <RegionFields
                required
                defaultValues={{
                  province: data.province,
                  city: data.city,
                  district: data.district,
                  street: data.street
                }}
              />
            </FormSection>

            <FormSection title="详细地址与联系方式">
              <FormGrid columns={1}>
                <ProFormText
                  name="address"
                  label="详细地址"
                  fieldProps={{ size: "large", maxLength: 200, showCount: true }}
                />
                <FormGrid columns={2}>
                  <ProFormText
                    name="contactPhone"
                    label="联系电话"
                    rules={[
                      { required: true, message: "请输入联系电话" },
                      { pattern: /^[\d\-\s+()]{5,20}$/, message: "电话号码格式不正确" }
                    ]}
                    fieldProps={{ size: "large", maxLength: 20 }}
                  />
                  <ProFormText
                    name="contactEmail"
                    label="邮箱"
                    rules={[{ type: "email", message: "邮箱格式不正确" }]}
                    fieldProps={{ size: "large", maxLength: 120 }}
                  />
                </FormGrid>
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>

          <StepsForm.StepForm
            name="finance"
            title={STEP_TITLES[2]}
            initialValues={{
              contactPhone: data.contactPhone,
              contactEmail: data.contactEmail,
              creditLimitAmount: data.creditLimitAmount
                ? Number(data.creditLimitAmount)
                : undefined,
              paymentTermDays: data.paymentTermDays,
              status: data.status
            }}
            onFinish={async () => true}
          >
            <FormSection title="授信与账期">
              <FormGrid columns={2}>
                <ProFormDigit
                  name="creditLimitAmount"
                  label="授信额度"
                  min={0}
                  fieldProps={{
                    size: "large",
                    precision: 2,
                    prefix: "¥",
                    addonAfter: "元"
                  }}
                />
                <ProFormDigit
                  name="paymentTermDays"
                  label="账期"
                  min={0}
                  max={365}
                  fieldProps={{ size: "large", suffix: "天" }}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="状态">
              <FormGrid columns={1}>
                <ProFormSelect
                  name="status"
                  label="客户状态"
                  options={statusOptions}
                  fieldProps={{ size: "large" }}
                />
                <Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    状态切换的合法性由后端校验（如 已冻结 需要无进行中合同 / 未对账回款）
                  </Text>
                </Space>
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>
        </StepsForm>
      </FormCard>
    </Page>
  );
}
