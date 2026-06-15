"use client";

import { useRef } from "react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Typography } from "antd";
import { StatusTag } from "@/components/status-tag";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { FormPageSkeleton } from "@/components/form-page-skeleton";

const { Text } = Typography;

export default function EditProjectPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const { data, isLoading } = // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edit page reads many dynamic fields
  useSWR<any>(`/api/projects/${id}`);

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/projects/${id}`)} title="编辑项目" />
        <FormPageSkeleton />
      </Page>
    );
  }

  if (!["PLANNED", "SUSPENDED"].includes(data.status)) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/projects/${id}`)} title="编辑项目" />
        <FormCard>
          <Text type="warning">
            当前状态 <StatusTag status={data.status} domain="project" /> 不可编辑;仅 计划中 / 已暂停 可改。
          </Text>
        </FormCard>
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/projects/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle={`所属合同:${data.contract?.contractNo ?? data.contractId ?? "-"}`}
      />
      <FormCard headerHint="所属合同不可改;项目止期必须晚于起期且不超过合同止期">
        <ProForm
          submitter={false}
          formRef={formRef}
          layout="vertical"
          initialValues={{
            name: data.name,
            serviceScope: data.serviceScope,
            startDate: data.startDate ? new Date(data.startDate) : undefined,
            endDate: data.endDate ? new Date(data.endDate) : undefined,
            budgetAmount: data.budgetAmount ? Number(data.budgetAmount) : undefined
          }}
          onFinish={async (values) => {
            const payload = {
              ...values,
              startDate: values.startDate?.toISOString?.(),
              endDate: values.endDate?.toISOString?.()
            };
            const res = await fetch(`/api/projects/${id}`, {
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
            message.success("已保存");
            router.push(`/projects/${id}`);
            return true;
          }}
        >
          <FormSection title="项目信息">
            <FormGrid columns={1}>
              <ProFormText
                name="name"
                label="项目名称"
                rules={[{ required: true, max: 100 }]}
                fieldProps={{ size: "large" }}
              />
              <ProFormTextArea
                name="serviceScope"
                label="服务范围"
                rules={[{ required: true }]}
                fieldProps={{ size: "large", rows: 4, maxLength: 2000, showCount: true }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="项目起止期">
            <FormGrid columns={2}>
              <ProFormDatePicker
                name="startDate"
                label="起期"
                rules={[{ required: true }]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
              <ProFormDatePicker
                name="endDate"
                label="止期"
                rules={[
                  { required: true, message: "请选择止期" },
                  ({ getFieldValue }: { getFieldValue: (n: string) => unknown }) => ({
                    validator(_: unknown, value: unknown) {
                      const start = getFieldValue("startDate") as string | number | Date | null | undefined;
                      if (!value || !start) return Promise.resolve();
                      const d = new Date(value as string).getTime();
                      const s = new Date(start).getTime();
                      if (d <= s) {
                        return Promise.reject(new Error("止期必须晚于起期"));
                      }
                      return Promise.resolve();
                    }
                  })
                ]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="预算">
            <FormGrid columns={1}>
              <ProFormDigit
                name="budgetAmount"
                label="项目预算"
                min={0}
                fieldProps={{ size: "large", precision: 2, prefix: "¥", addonAfter: "元" }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              项目预算为参考值,合同总额是最终结算依据。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => router.push(`/projects/${id}`)}
            submitText="保存修改"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
