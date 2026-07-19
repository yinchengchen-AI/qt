"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Typography } from "antd";

import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { useDict, groupDictByLegacy } from "@/lib/dict-client";
import { useContractTitleAutofill } from "@/lib/use-contract-title-autofill";
import { extractOptionLabel } from "@/lib/extract-option-label";
import { toIsoDateTime } from "@/lib/format";
import { proCustomRequest } from "@/lib/upload-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar, AmountTaxFields } from "@/components/form";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "LUMP_SUM", label: "一次性" },
  { value: "BY_PHASE", label: "按阶段" },
  { value: "BY_MONTH", label: "按月" },
  { value: "BY_QUARTER", label: "按季" }
];

type Customer = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string;
  // listCustomers 返回全字段, 预填"负责人"要用; 没有显式 select 所以这里字段可选
  ownerUserId?: string | null;
};

type ActiveUser = {
  id: string;
  employeeNo: string;
  name: string;
};




export default function NewContractPage() {
  const router = useRouter();
  const goBack = useGoBack("/contracts");
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const serviceType = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(serviceType), [serviceType]);
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState("");
  // ProFormSelect 在 showSearch + optionFilterProp="label" 时会把 onChange 收到的 option.label
  // 改写成 React element(用来高亮匹配的子串),所以拿不到原始字符串。
  // 在 request 里同步把 value -> name 存进来,onChange 用 value 反查。
  const [customerNameById, setCustomerNameById] = useState<Map<string, string>>(() => new Map());
  // 选客户时记录其业务负责人,新建合同时给"负责人"字段预填
  // (合同 ownerUserId 默认 = customer.ownerUserId, 跟历史行为一致; admin 可手动改)
  const [customerOwnerById, setCustomerOwnerById] = useState<Map<string, string>>(() => new Map());
  const { tryAutoFill } = useContractTitleAutofill({ formRef, serviceType, customerName: selectedCustomerLabel });

  // 会话异步加载完成后再把当前用户写入签订人默认值;initialValue 是一次性应用,
  // 第一次渲染时 session 还没回来,这里补一次 setFieldValue
  useEffect(() => {
    if (currentUserId && formRef.current) {
      formRef.current.setFieldValue("signerId", currentUserId);
    }
  }, [currentUserId]);

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="新建合同"
        subtitle="为客户创建合同，保存即生成草稿，字段完整且附件就位后自动发布为生效"
      />
      <FormCard headerHint="服务止期必须晚于起期，否则无法保存">
        <ProForm
          formRef={formRef}
          layout="vertical"
          submitter={false}
          onFinish={async (values) => {
            const payload = {
              ...values,
              signDate: toIsoDateTime(values.signDate),
              startDate: toIsoDateTime(values.startDate),
              endDate: toIsoDateTime(values.endDate),
              // 合同结构化交付物 (deliverables) 已下线; 实际交付文件走 Attachment.isDeliverable
              // attachments: 来自 ProFormUploadButton 的 customRequest 上传结果
              // 元素形状:{ uid, name, status, response: { id, name, mimeType, size, uploadedBy, uploadedAt } }
              attachments: (values.attachments ?? [])
                .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
                .filter((r: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id))
            };
            const res = await fetch("/api/contracts", {
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
            message.success("合同已创建（草稿），字段完整且附件就位后会自动发布为生效");
            router.push(`/contracts/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="签约主体" description="选定客户作为合同甲方，并预填该客户的业务负责人（可手动修改）">
            <FormGrid columns={1}>
              <ProFormSelect
                name="customerId"
                label="客户"
                placeholder="按客户名 / 客户编号搜索"
                showSearch
                style={{ width: "100%" }}
                rules={[
                  { required: true, message: "请选择客户" }
                ]}
                fieldProps={{
                  size: "large",
                  style: { width: "100%" },
                  optionFilterProp: "label",
                  onChange: (_value: unknown, option: unknown) => {
                    // ProFormSelect 搜索后会把 option.label 改写成 React element(用来高亮匹配子串),
                    // 原始字符串只能靠 value 在同步保存的 map 里反查,见 lib/extract-option-label.ts
                    const label = extractOptionLabel(_value, option, customerNameById);
                    setSelectedCustomerLabel(label);
                    // 客户切换时,把"负责人"预填为该客户的业务负责人; 用户后续可手动改
                    const ownerId = customerOwnerById.get(String(_value));
                    if (ownerId && formRef.current) {
                      formRef.current.setFieldValue("ownerUserId", ownerId);
                    }
                    // 客户/服务类型/签订日变化时尝试自动填充合同标题(空标题或仍是上次自动填充值才覆盖)
                    tryAutoFill({ customerName: label });
                  }
                }}
                request={async (params: { keyWords?: string }) => {
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "50");
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/customers?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  // 客户状态机已下线 (R-03): 不再按 status 过滤, 所有客户都可作为合同甲方
                  const list = j.data.list as Customer[];
                  // 同步保存 id -> name 映射,供 onChange 在 ProFormSelect 把 label 改写成 React element 时反查
                  setCustomerNameById((prev) => {
                    const m = new Map(prev);
                    for (const c of list) m.set(c.id, c.name);
                    return m;
                  });
                  setCustomerOwnerById((prev) => {
                    const m = new Map(prev);
                    // 优先用后端 listCustomers 已经返回的 ownerUserId; 客户端只缓存不二次查询
                    for (const c of list) {
                      if (c.ownerUserId) m.set(c.id, c.ownerUserId);
                    }
                    return m;
                  });
                  return list.map((c) => ({
                    value: c.id,
                    label: c.name,
                    // name 字段作为字符串备份:ProFormSelect 高亮时改写 label 但不会动 name
                    name: c.name,
                    // 业务字段,回填到其它字段
                    contactPhone: c.contactPhone,
                    contactName: c.contactName,
                    contactTitle: c.contactTitle,
                  }));
                }}
              />
              {selectedCustomerLabel && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>已选客户：</Text>
                  <Text copyable>{selectedCustomerLabel}</Text>
                </div>
              )}
            </FormGrid>
          </FormSection>

          <FormSection title="合同信息">
            <FormGrid columns={1}>
              <ProFormText
                name="contractNo"
                label="合同编号"
                placeholder="如：QT-HT-2026-0001（保存后不再校验可改）"
                rules={[
                  { required: true, message: "请输入合同编号（必填）" },
                  { min: 1, max: 50 }
                ]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="serviceType"
                label="服务类型"
                placeholder="请选择"
                options={serviceTypeOptions}
                rules={[{ required: true, message: "请选择服务类型（必填）" }]}
                showSearch
                fieldProps={{
                  size: "large",
                  onChange: () => tryAutoFill()
                }}
              />
              <ProFormText
                name="title"
                label="合同标题"
                placeholder="如：杭州阿里巴巴 2026 年安全咨询服务合同"
                rules={[
                  { required: true, message: "请输入合同标题（必填）" },
                  { min: 2, max: 200 }
                ]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="paymentMethod"
                label="付款方式"
                placeholder="请选择"
                options={PAYMENT_METHOD_OPTIONS}
                rules={[{ required: true, message: "请选择付款方式（必填）" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
            <FormGrid columns={1}>
              <ProFormSelect
                name="signerId"
                label="签订人"
                placeholder="按姓名 / 工号搜索员工"
                tooltip="默认为当前登录员工；管理员可改为任意员工，便于代录"
                showSearch
                initialValue={currentUserId}
                rules={[{ required: true, message: "请选择合同签订人（必填）" }]}
                fieldProps={{
                  size: "large",
                  optionFilterProp: "label"
                }}
                request={async (params: { keyWords?: string }) => {
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "100");
                  qs.set("status", "ACTIVE");
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/users?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return (j.data.list as ActiveUser[]).map((u) => ({
                    value: u.id,
                    label: `${u.name} (${u.employeeNo})`
                  }));
                }}
              />
              <ProFormSelect
                name="ownerUserId"
                label="负责人"
                placeholder="按姓名 / 工号搜索员工"
                tooltip="默认继承所选客户的业务负责人；管理员可改为任意在职员工，便于代录 / 转交"
                showSearch
                rules={[{ required: true, message: "请选择合同负责人（必填）" }]}
                fieldProps={{
                  size: "large",
                  optionFilterProp: "label"
                }}
                request={async (params: { keyWords?: string }) => {
                  const qs = new URLSearchParams();
                  qs.set("pageSize", "100");
                  qs.set("status", "ACTIVE");
                  qs.set("keyword", params.keyWords ?? "");
                  const r = await fetch(`/api/users?${qs}`, { credentials: "include" });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return (j.data.list as ActiveUser[]).map((u) => ({
                    value: u.id,
                    label: `${u.name} (${u.employeeNo})`
                  }));
                }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="服务期">
            <FormGrid columns={3}>
              <ProFormDatePicker
                name="signDate"
                label="签订日期"
                rules={[{ required: true }]}
                fieldProps={{
                  size: "large",
                  style: { width: "100%" },
                  onChange: () => tryAutoFill()
                }}
              />
              <ProFormDatePicker name="startDate" label="服务起期" rules={[{ required: true }]} fieldProps={{ size: "large", style: { width: "100%" } }} />
              <ProFormDatePicker
                name="endDate"
                label="服务止期"
                rules={[
                  { required: true, message: "请选择服务止期（必填，且晚于起期）" },
                  ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
                    validator(_: unknown, value: unknown) {
                      const start = getFieldValue("startDate") as string | number | Date | null | undefined;
                      if (!value || !start) return Promise.resolve();
                      const d = new Date(value as string | number | Date);
                      const s = new Date(start);
                      if (Number.isNaN(d.getTime()) || Number.isNaN(s.getTime())) return Promise.resolve();
                      if (d.getTime() <= s.getTime()) {
                        return Promise.reject(new Error("服务止期必须晚于起期"));
                      }
                      return Promise.resolve();
                    }
                  })
                ]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="金额与税率">
            <AmountTaxFields
              amountName="totalAmount"
              amountLabel="合同总额（含税）"
              amountPlaceholder="请输入合同总额（元）"
              requiredMessage="请输入合同总额（必填）"
              initialTaxRate={0.06}
            />
          </FormSection>

          <FormSection title="备注" description="可填写签约背景、特殊条款、客户偏好等；不影响审批流">
            <FormGrid columns={1}>
              <ProFormTextArea
                name="remark"
                label="合同备注"
                placeholder="选填，500 个字符以内"
                rules={[{ max: 500, message: "备注不超过 500 个字符" }]}
                fieldProps={{
                  autoSize: { minRows: 3, maxRows: 6 },
                  showCount: true,
                  maxLength: 500
                }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="合同附件" description="至少上传 1 个盖章版的合同 PDF，保存后满足条件即自动发布为生效">
            <UploadButton
              name="attachments"
              label="上传"
              max={5}
              fieldProps={{
                name: "file",
                customRequest: proCustomRequest()
              }}
            />
          </FormSection>

          <Space style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              草稿状态可编辑;保存后若字段完整且附件就位,系统会自动将合同从草稿发布为生效状态。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => goBack}
            submitText="保存草稿"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
