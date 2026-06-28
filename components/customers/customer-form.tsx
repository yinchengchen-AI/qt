"use client";

import React, { useEffect, useRef, useState } from "react";

import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormTextArea
} from "@ant-design/pro-components";
import { App as AntdApp, Form, Input } from "antd";
import { useDict } from "@/lib/dict-client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { LocationCascader } from "@/components/form/LocationCascader";
import { ZHEJIANG_DIVISIONS, type DivisionNode } from "@/lib/china-divisions";
import { isValidCreditCode } from "@/lib/credit-code";

export type CustomerFormValues = {
  name?: string;
  shortName?: string | null;
  unifiedSocialCreditCode?: string | null;
  customerType?: string;
  industry?: string | null;
  sourceChannel?: string | null;
  scale?: string | null;
  reason?: string;
  contactName?: string | null;
  contactTitle?: string | null;
  contactPhone?: string;
  province?: string;
  city?: string;
  district?: string | null;
  town?: string | null;
  address?: string | null;
  ownerUserId?: string;
};

type Props = {
  mode: "create" | "edit";
  title: string;
  subtitle?: string;
  submitText: string;
  back: () => void;
  /** 编辑页传当前客户数据, 用于状态机下拉预填 / 高亮 */
  initialValues?: CustomerFormValues & { code?: string };
  onSubmit: (values: CustomerFormValues) => Promise<{ ok: boolean; message?: string }>;
  children?: React.ReactNode;
};

export function CustomerForm(props: Props) {
  const { mode, title, subtitle, submitText, back, initialValues, onSubmit, children } = props;
  const { message } = AntdApp.useApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [cascadeValue, setCascadeValue] = useState<string[]>([]);
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const scaleDict = useDict("CUSTOMER_SCALE");

useEffect(() => {
    if (!initialValues) return;
    const codes: string[] = [];
    let current: DivisionNode[] | undefined = ZHEJIANG_DIVISIONS;
    for (const label of [initialValues.province, initialValues.city, initialValues.district, initialValues.town]) {
      if (!label) break;
      const node: DivisionNode | undefined = current?.find((n) => n.label === label);
      if (!node) break;
      codes.push(node.value);
      current = node.children;
      if (!current) break;
    }
    setCascadeValue(codes);
  }, [initialValues]);

const handleCascadeChange = (value: string[], labels: string[]) => {
    setCascadeValue(value);
    formRef.current?.setFieldsValue({
      province: labels[0] || "",
      city: labels[1] || "",
      district: labels[2] || "",
      town: labels[3] || "",
      address: labels.filter(Boolean).join("")
    });
  };

  return (
    <Page compact>
      <PageHeader back={back} title={title} subtitle={subtitle} />
      {children}
      {!children && (
      <ProForm<CustomerFormValues>
        formRef={formRef}
        layout="vertical"
        submitter={false}
        initialValues={initialValues}
        onFinish={async (values) => {
          const res = await onSubmit(values);
          if (!res.ok) {
            if (res.message) message.error(res.message);
            return false;
          }
          return true;
        }}
      >
        <FormCard headerHint={mode === "create" ? "标 * 为必填；字典项（类型、行业、来源、规模）请到「系统管理 → 数据字典」维护" : undefined}>
          <FormSection title="客户基础信息" description="将用于合同、发票、报告等正式抬头，请确保与营业执照一致">
            <ProFormText
              name="name"
              label="客户全称"
              placeholder="如：杭州阿里巴巴有限公司（与营业执照保持一致）"
              rules={[
                { required: true, message: "请输入客户全称（与营业执照一致）" },
                { min: 2, max: 100 }
              ]}
              fieldProps={{ size: "large", maxLength: 100, showCount: true }}
            />
            <FormGrid columns={2}>
              <ProFormText
                name="shortName"
                label="简称"
                placeholder="列表中显示的简称，可空"
                fieldProps={{ size: "large", maxLength: 50, showCount: true }}
              />
              <ProFormText
                name="unifiedSocialCreditCode"
                label="统一社会信用代码"
                placeholder="18 位字符；企业必填，政府 / 事业单位可空"
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

          <FormSection title="类型与规模" description={mode === "create" ? "类型决定后续合同 / 项目可走的流程；规模用于客户分层维护" : undefined}>
            <FormGrid columns={2}>
              <ProFormSelect
                name="customerType"
                label="客户类型"
                placeholder="请选择客户类型"
                options={customerType.map((d) => ({ value: d.code, label: d.label }))}
                rules={[{ required: true, message: "请选择客户类型（必填）" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="scale"
                label="客户规模"
                placeholder="请选择客户规模（选填）"
                options={scaleDict.map((d) => ({ value: d.code, label: d.label }))}
                showSearch
                allowClear
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="industry"
                label="行业"
                placeholder="请选择所属行业（选填）"
                options={industryDict.map((d) => ({ value: d.code, label: d.label }))}
                showSearch
                allowClear
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="sourceChannel"
                label="客户来源"
                placeholder="请选择客户来源（选填）"
                options={sourceDict.map((d) => ({ value: d.code, label: d.label }))}
                showSearch
                allowClear
                fieldProps={{ size: "large" }}
              />
            </FormGrid>

          </FormSection>

          <FormSection title="位置与联系" description="级联选择省 / 市 / 区 / 镇街，将自动拼装到详细地址">
            <FormGrid columns={2}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13, color: "rgba(0,0,0,0.88)" }}>
                  所在地 <span style={{ color: "#ff4d4f" }}>*</span>
                </div>
                <LocationCascader
                  value={cascadeValue}
                  options={ZHEJIANG_DIVISIONS}
                  onChange={handleCascadeChange}
                />
              </div>
              <ProFormTextArea
                name="address"
                label="详细地址"
                placeholder="级联选择后会自动填充，可继续补充门牌号、楼层、房间号等"
                fieldProps={{ size: "large", maxLength: 200, showCount: true, autoSize: { minRows: 1, maxRows: 3 } }}
              />
            </FormGrid>
            <Form.Item name="province" rules={[{ required: true, message: "请选择省 / 市 / 区（必填）" }]} noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="city" rules={[{ required: true, message: "请选择省 / 市 / 区（必填）" }]} noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="district" noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="town" noStyle>
              <Input type="hidden" />
            </Form.Item>
            <FormGrid columns={2}>
              <ProFormText
                name="contactName"
                label="联系人姓名"
                placeholder="如：王经理（选填）"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="contactTitle"
                label="联系人职务"
                placeholder="如：安全总监（选填）"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
            </FormGrid>
            <ProFormText
              name="contactPhone"
              label="联系电话"
              placeholder="如：13800001111 或 0571-88886666"
              rules={[
                { required: true, message: "请输入联系电话（手机或座机）" },
                { pattern: /^\+?[\d][\d\-\s()]*$/, message: "电话号码格式不正确，请输入手机号或带区号的座机号" }
              ]}
              fieldProps={{ size: "large", maxLength: 20 }}
            />
          </FormSection>
        </FormCard>

        <SubmitBar
          onSubmit={() => formRef.current?.submit()}
          onCancel={back}
          submitText={submitText}
        />
      </ProForm>
      )}
    </Page>
  );
}
