"use client";

import { useRef } from "react";

import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormTextArea
} from "@ant-design/pro-components";
import { App as AntdApp } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";
import { useStatusOptions } from "@/lib/use-status-enum";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
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
  const formRef = useRef<any>(null);
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const statusOptions = useStatusOptions("customer");
  const { data, isLoading } = // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edit page reads many dynamic fields
  useSWR<any>(`/api/customers/${id}`);

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

          <FormSection title="位置与联系" description="支持后续在详情页维护更多联系人">
            <FormGrid columns={2}>
              <ProFormText
                name="province"
                label="所在省份"
                rules={[{ required: true, message: "请输入省份" }, { max: 20 }]}
                fieldProps={{ size: "large", maxLength: 20 }}
              />
              <ProFormText
                name="city"
                label="所在城市"
                rules={[{ required: true, message: "请输入城市" }, { max: 40 }]}
                fieldProps={{ size: "large", maxLength: 40 }}
              />
            </FormGrid>
            <ProFormTextArea
              name="address"
              label="详细地址"
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
