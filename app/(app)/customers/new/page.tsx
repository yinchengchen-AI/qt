"use client";
import { StepsForm, ProFormText, ProFormSelect, ProFormDigit } from "@ant-design/pro-components";
import { App as AntdApp, Card, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useDict } from "@/lib/dict-client";
import { useStatusOptions } from "@/lib/use-status-enum";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { RegionFields } from "@/components/form/RegionFields";

const { Text } = Typography;

const STEP_TITLES = ["基本信息", "位置与联系", "财务与等级"];

export default function NewCustomerPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");
  // 新建不允许 FROZEN
  const statusOptions = useStatusOptions("customer", (c) => c !== "FROZEN");

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/customers")}
        title="新建客户"
        subtitle="线索录入 → 位置与联系 → 财务与等级;带 * 必填"
      />
      <FormCard headerHint="客户编号、创建人、创建时间由系统自动生成,无需填写">
        <StepsForm
          onFinish={async (values) => {
            const res = await fetch("/api/customers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(values)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("创建成功");
            router.push(`/customers/${j.data.id}`);
            return true;
          }}

        >
          {/* ========== Step 1: 基本信息 ========== */}
          <StepsForm.StepForm
            name="base"
            title={STEP_TITLES[0]}
            onFinish={async () => true}
          >
            <FormSection
              title="客户全称与简称"
              description="用于合同 / 发票 / 报告抬头"
            >
              <FormGrid columns={1}>
                <ProFormText
                  name="name"
                  label="客户全称"
                  placeholder="如:杭州阿里巴巴有限公司"
                  rules={[
                    { required: true, message: "客户全称为必填" },
                    { min: 2, max: 100 }
                  ]}
                  fieldProps={{ size: "large" }}
                />
                <ProFormText
                  name="shortName"
                  label="简称"
                  placeholder="用于列表展示;可空"
                  fieldProps={{ size: "large", maxLength: 50, showCount: true }}
                />
              </FormGrid>
            </FormSection>

            <FormSection
              title="类型与等级"
              description="等级影响后续折扣 / 信用账期默认"
            >
              <FormGrid columns={2}>
                <ProFormSelect
                  name="customerType"
                  label="客户类型"
                  placeholder="请选择"
                  options={customerType.map((d) => ({ value: d.code, label: d.label }))}
                  rules={[{ required: true, message: "请选择客户类型" }]}
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="level"
                  label="客户等级"
                  placeholder="默认 C 级"
                  initialValue="C"
                  options={customerLevel.map((d) => ({ value: d.code, label: d.label }))}
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="industry"
                  label="行业"
                  placeholder="如:制造业 / 金融 / 政府"
                  showSearch
                  allowClear
                  fieldProps={{ size: "large" }}
                />
                <ProFormSelect
                  name="sourceChannel"
                  label="客户来源"
                  placeholder="如:展会 / 转介绍 / 官网"
                  showSearch
                  allowClear
                  fieldProps={{ size: "large" }}
                />
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>

          {/* ========== Step 2: 位置与联系 ========== */}
          <StepsForm.StepForm
            name="region"
            title={STEP_TITLES[1]}
            onFinish={async () => true}
          >
            <FormSection
              title="所在地区"
              description="当前仅支持杭州市(区/县 + 街道)"
            >
              <RegionFields required />
            </FormSection>

            <FormSection title="详细地址与联系方式">
              <FormGrid columns={1}>
                <ProFormText
                  name="address"
                  label="详细地址"
                  placeholder="街道名 + 门牌号(可空)"
                  fieldProps={{ size: "large", maxLength: 200, showCount: true }}
                />
                <FormGrid columns={2}>
                  <ProFormText
                    name="contactPhone"
                    label="联系电话"
                    placeholder="手机或座机"
                    rules={[
                      { required: true, message: "请输入联系电话" },
                      { pattern: /^[\d\-\s+()]{5,20}$/, message: "电话号码格式不正确" }
                    ]}
                    fieldProps={{ size: "large", maxLength: 20 }}
                  />
                  <ProFormText
                    name="contactEmail"
                    label="邮箱"
                    placeholder="如:contact@example.com(可空)"
                    rules={[{ type: "email", message: "邮箱格式不正确" }]}
                    fieldProps={{ size: "large", maxLength: 120 }}
                  />
                </FormGrid>
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>

          {/* ========== Step 3: 财务与等级 ========== */}
          <StepsForm.StepForm
            name="finance"
            title={STEP_TITLES[2]}
            onFinish={async () => true}
          >
            <FormSection
              title="授信与账期"
              description="新建后可在客户详情页调整;不影响初始状态"
            >
              <FormGrid columns={2}>
                <ProFormDigit
                  name="creditLimitAmount"
                  label="授信额度"
                  placeholder="0 表示不授信"
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
                  placeholder="默认 30 天"
                  initialValue={30}
                  min={0}
                  max={365}
                  fieldProps={{ size: "large", suffix: "天" }}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="初始状态">
              <FormGrid columns={1}>
                <ProFormSelect
                  name="status"
                  label="初始状态"
                  options={statusOptions}
                  initialValue="LEAD"
                  fieldProps={{ size: "large" }}
                />
                <Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    新建客户默认 <Tag color="blue">LEAD 线索</Tag>。如已签约请选
                    <Tag color="green">SIGNED 已签约</Tag>
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
