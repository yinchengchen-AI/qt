"use client";

import { useMemo, useRef } from "react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Typography } from "antd";
import { StatusTag } from "@/components/status-tag";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { useDict, groupDictByLegacy } from "@/lib/dict-client";
import { useContractTitleAutofill } from "@/lib/use-contract-title-autofill";
import { toIsoDateTime } from "@/lib/format";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { proCustomRequest } from "@/lib/upload-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import { TAX_RATE_OPTIONS, TAX_RATE_LABELS } from "@/lib/validators/_shared";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "LUMP_SUM", label: "一次性" },
  { value: "BY_PHASE", label: "按阶段" },
  { value: "BY_MONTH", label: "按月" },
  { value: "BY_QUARTER", label: "按季" }
];


export default function EditContractPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/contracts");
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const { data, isLoading } = // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edit page reads many dynamic fields
  useSWR<any>(`/api/contracts/${id}`);
  const serviceType = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(serviceType), [serviceType]);
  const { tryAutoFill, syncFromInitial } = useContractTitleAutofill({
    formRef,
    serviceType,
    customerName: (() => {
              const raw = (data as { customerName?: unknown } | undefined)?.customerName;
              return typeof raw === "string" ? raw : "";
            })()
  });

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={goBack} title="编辑合同" />
        <FormPageSkeleton />
      </Page>
    );
  }

  // 状态机门控: 新模型下, 非 admin 仅 DRAFT 可编辑;
  // admin 任意态都能打开编辑页 (跟后端 service 同步).
  // 业务/财务/行政角色在 ACTIVE/CLOSED 状态下打开会提示不可编辑.
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";
  if (!isAdmin && data.status !== "DRAFT") {
    return (
      <Page compact>
        <PageHeader back={goBack} title="编辑合同" />
        <FormCard>
          <Text type="warning">
            当前状态 <StatusTag status={data.status} domain="contract" /> 不可编辑;仅 草稿 可改 (管理员可改任意状态)。
          </Text>
        </FormCard>
      </Page>
    );
  }

  // 既有标题若就是自动生成的格式,初始化 hook 的 ref 让后续 serviceType/signDate 改动顺带重算;
  // 手工改过的标题不动
  if (data) {
    const y = data.signDate ? new Date(data.signDate).getFullYear() : null;
    syncFromInitial(data.title, data.serviceType, y);
  }

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="编辑合同"
        subtitle="客户与创建人不可修改；合同编号、服务起止期可改，止期必须晚于起期"
      />
      <FormCard headerHint="客户一旦签约不可更换，如需更换请新建合同后再迁移数据">
        <ProForm
          submitter={false}
          formRef={formRef}
          layout="vertical"
          initialValues={{
            contractNo: data.contractNo,
            title: data.title,
            serviceType: data.serviceType,
            paymentMethod: data.paymentMethod,
            ownerUserId: data.ownerUserId,
            remark: data.remark ?? undefined,
            signDate: data.signDate ? new Date(data.signDate) : undefined,
            startDate: data.startDate ? new Date(data.startDate) : undefined,
            endDate: data.endDate ? new Date(data.endDate) : undefined,
            totalAmount: data.totalAmount ? Number(data.totalAmount) : undefined,
            taxRate: data.taxRate != null ? Number(data.taxRate) : 0.06,
            // 合同结构化交付物 (deliverables) 已下线; 实际交付文件走 Attachment.isDeliverable
          }}
          onFinish={async (values) => {
            // 新上传的(从 ProFormUploadButton):[{ uid, name, status, response: { id, ... } }]
            // 与已有(data.attachments)合并,一起发给后端
            const existing = (data.attachments ?? []) as Array<{ id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string }>;
            const newlyUploaded = (values.attachments ?? [])
              .map((f: { response?: { id?: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string } }) => f.response)
              .filter((r: { id?: string } | undefined): r is { id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string } => Boolean(r && r.id));
            const merged = [...existing, ...newlyUploaded];
            const payload = {
              ...values,
              signDate: toIsoDateTime(values.signDate),
              startDate: toIsoDateTime(values.startDate),
              endDate: toIsoDateTime(values.endDate),
              // 合同结构化交付物 (deliverables) 已下线; 实际交付文件走 Attachment.isDeliverable
              attachments: merged
            };
            const res = await fetch(`/api/contracts/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("合同已保存");
            router.push(`/contracts/${id}`);
            return true;
          }}
        >
          <FormSection title="客户">
            <FormGrid columns={1}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>客户：</Text>
                <Text copyable>{data.customerName}</Text>
              </div>
            </FormGrid>
          </FormSection>

          <FormSection title="合同信息">
            <FormGrid columns={1}>
              <ProFormText
                name="contractNo"
                label="合同编号"
                rules={[
                  { required: true, message: "请输入合同编号（必填）" },
                  { min: 1, max: 50 }
                ]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="serviceType"
                label="服务类型"
                options={serviceTypeOptions}
                showSearch
                rules={[{ required: true, message: "请选择服务类型（必填）" }]}
                fieldProps={{
                  size: "large",
                  onChange: () => tryAutoFill()
                }}
              />
              <ProFormText
                name="title"
                label="合同标题"
                rules={[
                  { required: true, message: "请输入合同标题（必填）" },
                  { min: 2, max: 200 }
                ]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="paymentMethod"
                label="付款方式"
                options={PAYMENT_METHOD_OPTIONS}
                rules={[{ required: true, message: "请选择付款方式（必填）" }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormSelect
                name="ownerUserId"
                label="负责人"
                placeholder="按姓名 / 工号搜索员工"
                tooltip="管理员可改为任意在职员工，业务上等同于把合同转交给对方"
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
                  return (j.data.list as Array<{ id: string; name: string; employeeNo: string }>).map((u) => ({
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
            <FormGrid columns={2}>
              <ProFormDigit
                name="totalAmount"
                label="合同总额（含税）"
                min={0.01}
                rules={[{ required: true, message: "请输入合同总额（必填）" }]}
                fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
              />
              <ProFormSelect
                name="taxRate"
                label="税率"
                options={TAX_RATE_OPTIONS.map((v, i) => ({ value: v, label: TAX_RATE_LABELS[i] }))}
                rules={[{ required: true, message: "请选择适用税率（必填）" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="备注">
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

          <FormSection title="合同附件" description="可继续添加附件；已有附件的删除请到详情页操作">
            <FormGrid columns={1}>
              <AttachmentList
                items={(data.attachments ?? []) as AttachmentItem[]}
                allowDelete={false}
                showHeader={false}
              />
              <UploadButton
                name="attachments"
                label="新增附件"
                max={5}
                fieldProps={{
                  name: "file",
                  customRequest: proCustomRequest({ contractId: id })
                }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              客户不可更换;草稿 / 待审批 / 已暂停 状态下可编辑合同编号及其它字段。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => router.push(`/contracts/${id}`)}
            submitText="保存修改"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
