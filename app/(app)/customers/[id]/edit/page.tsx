"use client";

import { useEffect, useRef, useState } from "react";

import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormTextArea
} from "@ant-design/pro-components";
import { App as AntdApp, Form, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";
import { useStatusOptions } from "@/lib/use-status-enum";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { LocationCascader } from "@/components/form/LocationCascader";
import { DIVISIONS, type DivisionNode } from "@/lib/china-divisions";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { isValidCreditCode } from "@/lib/credit-code";

type CustomerData = {
  name?: string;
  shortName?: string | null;
  unifiedSocialCreditCode?: string | null;
  customerType?: string;
  industry?: string | null;
  sourceChannel?: string | null;
  status?: string;
  contactName?: string | null;
  contactTitle?: string | null;
  contactPhone?: string;
  province?: string;
  city?: string;
  address?: string | null;
};

export default function EditCustomerPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [cascadeValue, setCascadeValue] = useState<string[]>([]);
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const scaleDict = useDict("CUSTOMER_SCALE");
  const statusOptions = useStatusOptions("customer");
  const { data, isLoading } = // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edit page reads many dynamic fields
  useSWR<any>(`/api/customers/${id}`);

  useEffect(() => {
    if (!data) return;
    const codes: string[] = [];
    let current: DivisionNode[] | undefined = DIVISIONS;
    for (const label of [data.province, data.city]) {
      const node: DivisionNode | undefined = current?.find((n) => n.label === label);
      if (!node) break;
      codes.push(node.value);
      current = node.children;
    }
    setCascadeValue(codes);
  }, [data]);
  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/customers/${id}`)} title="编辑客户" />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/customers/${id}`)}
        title={`编辑 ${data.name ?? ""}`}
        subtitle={`客户编号 ${data.code} 不可修改;创建人 / 创建时间详见详情页`}
      />
      <ProForm<CustomerData>
          formRef={formRef}
        layout="vertical"
        submitter={false}
        initialValues={{
          name: data.name,
          shortName: data.shortName,
          unifiedSocialCreditCode: data.unifiedSocialCreditCode,
          customerType: data.customerType,
          industry: data.industry,
          sourceChannel: data.sourceChannel,
          scale: data.scale,
          status: data.status,
          contactName: data.contactName,
          contactTitle: data.contactTitle,
          contactPhone: data.contactPhone,
          province: data.province,
          city: data.city,
          address: data.address
        }}
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
        <FormCard>
          <FormSection title="客户基础信息" description="用于合同 / 发票 / 报告抬头">
            <ProFormText
              name="name"
              label="客户全称"
              rules={[
                { required: true, message: "客户全称为必填" },
                { min: 2, max: 100 }
              ]}
              fieldProps={{ size: "large", maxLength: 100, showCount: true }}
            />
            <FormGrid columns={2}>
              <ProFormText
                name="shortName"
                label="简称"
                fieldProps={{ size: "large", maxLength: 50, showCount: true }}
              />
              <ProFormText
                name="unifiedSocialCreditCode"
                label="统一社会信用代码"
                rules={[
                  {
                    validator: async (_, value) => {
                      if (!value) return;
                      if (!isValidCreditCode(value)) throw new Error("统一社会信用代码格式错误");
                    }
                  }
                ]}
                fieldProps={{ size: "large", maxLength: 18 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="类型与规模">
            <FormGrid columns={2}>
              <ProFormSelect
                name="customerType"
                label="客户类型"
                options={customerType.map((d) => ({ value: d.code, label: d.label }))}
                rules={[{ required: true, message: "请选择客户类型" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="scale"
                label="客户规模"
                placeholder="请选择规模"
                options={scaleDict.map((d) => ({ value: d.code, label: d.label }))}
                showSearch
                allowClear
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
            <ProFormSelect
              name="status"
              label="客户状态"
              options={statusOptions}
              fieldProps={{ size: "large" }}
            />
          </FormSection>

          <FormSection title="位置与联系" description="选择省 / 市 / 区后自动填充">
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13, color: "rgba(0,0,0,0.88)" }}>
                所在地 <span style={{ color: "#ff4d4f" }}>*</span>
              </div>
              <LocationCascader
                value={cascadeValue}
                onChange={(labels) => {
                  formRef.current?.setFieldsValue({
                    province: labels[0] || "",
                    city: labels[1] || "",
                    town: labels[3] || "",
                    address: labels.filter(Boolean).join("")
                  });
                }}
              />
            </div>
            <Form.Item name="province" rules={[{ required: true, message: "请选择所在地" }]} noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="city" rules={[{ required: true, message: "请选择所在地" }]} noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="town" noStyle>
              <Input type="hidden" />
            </Form.Item>
            <ProFormTextArea
              name="address"
              label="详细地址"
              placeholder="级联选择后自动填充;可继续补充门牌号 / 楼层等信息"
              fieldProps={{ size: "large", maxLength: 200, showCount: true, autoSize: { minRows: 1, maxRows: 3 } }}
            />
            <FormGrid columns={2}>
              <ProFormText
                name="contactName"
                label="联系人姓名"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="contactTitle"
                label="联系人职务"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
            </FormGrid>
            <ProFormText
              name="contactPhone"
              label="联系电话"
              rules={[
                { required: true, message: "请输入联系电话" },
                { pattern: /^[\d\-\s+()]{5,20}$/, message: "电话号码格式不正确" }
              ]}
              fieldProps={{ size: "large", maxLength: 20 }}
            />
          </FormSection>
        </FormCard>

        <SubmitBar
          onSubmit={() => formRef.current?.submit()}
          onCancel={() => router.push(`/customers/${id}`)}
          submitText="保存"
        />
      </ProForm>
    </Page>
  );
}
