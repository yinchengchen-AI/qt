"use client";

import { useRef } from "react";

import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormTextArea
} from "@ant-design/pro-components";
import { App as AntdApp, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useDict } from "@/lib/dict-client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { LocationCascader } from "@/components/form/LocationCascader";
import { ZHEJIANG_DIVISIONS } from "@/lib/china-divisions";
import { isValidCreditCode } from "@/lib/credit-code";

export default function NewCustomerPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const scaleDict = useDict("CUSTOMER_SCALE");
  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/customers")}
        title="新建客户"
        subtitle="客户编号、创建人、创建时间由系统自动生成"
      />
      <ProForm
          formRef={formRef}
        layout="vertical"
        submitter={false}
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
        <FormCard headerHint="标 * 为必填;所有字典项在「系统管理 → 数据字典」维护">
          <FormSection title="客户基础信息" description="用于合同 / 发票 / 报告抬头">
            <ProFormText
              name="name"
              label="客户全称"
              placeholder="如:杭州阿里巴巴有限公司"
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
                placeholder="用于列表展示"
                fieldProps={{ size: "large", maxLength: 50, showCount: true }}
              />
              <ProFormText
                name="unifiedSocialCreditCode"
                label="统一社会信用代码"
                placeholder="18 位;企业必填,政府单位可空"
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

          <FormSection title="类型与规模" description="类型决定后续合同/项目可走的流程;规模用于客户分层维护">
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
          </FormSection>

        <FormSection title="位置与联系" description="级联选择省 / 市 / 区 / 镇街, 自动填充到详细地址">
            <FormGrid columns={2}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13, color: "rgba(0,0,0,0.88)" }}>
                  所在地 <span style={{ color: "#ff4d4f" }}>*</span>
                </div>
                <LocationCascader
                  options={ZHEJIANG_DIVISIONS}
                  onChange={(labels) => {
                    formRef.current?.setFieldsValue({
                      province: labels[0] || "",
                      city: labels[1] || "",
                      district: labels[2] || "",
                      // town 仍写入 (看板 / 镇街分布统计依赖), 表层不展示
                      town: labels[3] || "",
                      // address 自动填充级联 4 级名 (省/市/区/镇街), 用户可继续追加门牌号 / 楼层.
                      address: labels.filter(Boolean).join("")
                    });
                  }}
                />
              </div>
              <ProFormTextArea
                name="address"
                label="详细地址"
                placeholder="级联选择后自动填充;可继续补充门牌号 / 楼层等信息"
                fieldProps={{ size: "large", maxLength: 200, showCount: true, autoSize: { minRows: 1, maxRows: 3 } }}
              />
            </FormGrid>
            <Form.Item name="province" rules={[{ required: true, message: "请选择所在地" }]} noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item name="city" rules={[{ required: true, message: "请选择所在地" }]} noStyle>
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
                placeholder="如:王经理"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
              <ProFormText
                name="contactTitle"
                label="联系人职务"
                placeholder="如:安全总监"
                fieldProps={{ size: "large", maxLength: 50 }}
              />
            </FormGrid>
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
          </FormSection>
        </FormCard>

        <SubmitBar
          onSubmit={() => formRef.current?.submit()}
          onCancel={() => router.push("/customers")}
          submitText="创建客户"
        />
      </ProForm>
    </Page>
  );
}
