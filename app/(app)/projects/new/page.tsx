"use client";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDigit,
  ProFormDatePicker
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard, SubmitBar } from "@/components/form";
import { toIsoDateTime } from "@/lib/format";

const { Text } = Typography;

type Contract = {
  id: string;
  contractNo: string;
  title: string;
  customerName: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  serviceType: string;
  status: string;
};

type ActiveUser = {
  id: string;
  employeeNo: string;
  name: string;
};

export default function NewProjectPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  // ProForm 的 ProFormRef 类型未导出,用 any 承载动态表单引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [contractEnd, setContractEnd] = useState<string | null>(null);
  const [contractStart, setContractStart] = useState<string | null>(null);

  // 会话异步加载完成后再把当前用户写入项目负责人默认值;initialValue 是一次性应用,
  // 第一次渲染时 session 还没回来,这里补一次 setFieldValue
  useEffect(() => {
    if (currentUserId && formRef.current) {
      formRef.current.setFieldValue("managerUserId", currentUserId);
    }
  }, [currentUserId]);

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/projects")}
        title="新建项目"
        subtitle="从已生效合同拆解出可执行项目"
      />
      <FormCard headerHint="选合同后,项目起止期自动限制在该合同的服务期内;止期必须晚于起期">
        <ProForm
          submitter={false}
          formRef={formRef}
          layout="vertical"
          onFinish={async (values) => {
            const payload = {
              ...values,
              startDate: toIsoDateTime(values.startDate),
              endDate: toIsoDateTime(values.endDate)
            };
            const res = await fetch("/api/projects", {
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
            message.success("已创建");
            router.push(`/projects/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="所属合同" description="仅 已生效 / 执行中 状态的合同可选">
            <ProFormSelect
              name="contractId"
              label="合同"
              placeholder="搜索合同号 / 标题 / 客户名"
              showSearch
              rules={[
                { required: true, message: "请选择合同" }
              ]}
              fieldProps={{
                size: "large",
                optionFilterProp: "label"
              }}
              request={async (params: { keyWords?: string }) => {
                const qs = new URLSearchParams();
                qs.set("pageSize", "50");
                qs.set("keyword", params.keyWords ?? "");
                const r = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
                const j = await r.json();
                if (j.code !== 0) return [];
                return (j.data.list as Contract[])
                  .filter((c) => ["EFFECTIVE", "EXECUTING"].includes(c.status))
                  .map((c) => ({
                    value: c.id,
                    label: `${c.contractNo} · ${c.title}`,
                    customerName: c.customerName,
                    startDate: c.startDate,
                    endDate: c.endDate,
                    serviceType: c.serviceType
                  }));
              }}
              onChange={(_: unknown, opt: { startDate?: string; endDate?: string } | unknown) => {
                const o = opt as { startDate?: string; endDate?: string } | undefined;
                setContractStart(o?.startDate ?? null);
                setContractEnd(o?.endDate ?? null);
              }}
            />
          </FormSection>

          <FormSection title="项目信息">
            <FormGrid columns={1}>
              <ProFormText
                name="name"
                label="项目名称"
                placeholder="如:阿里巴巴 2026 第一季度 安全评估"
                rules={[
                  { required: true, message: "请输入项目名称" },
                  { max: 100 }
                ]}
                fieldProps={{ size: "large" }}
              />
              <ProFormTextArea
                name="serviceScope"
                label="服务范围"
                placeholder="详细说明本次项目要完成的工作(至少 1 项)"
                rules={[{ required: true, message: "请填写服务范围" }]}
                fieldProps={{ size: "large", rows: 4, maxLength: 2000, showCount: true }}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <ProFormSelect
                name="managerUserId"
                label="项目负责人"
                placeholder="搜索员工姓名/工号"
                tooltip="默认是当前登录员工;admin 可改成任意员工,方便代录"
                showSearch
                initialValue={currentUserId}
                rules={[{ required: true, message: "请选择项目负责人" }]}
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

          <FormSection
            title="项目起止期"
            description={
              contractEnd
                ? `必须在合同期 ${contractStart?.slice(0, 10)} ~ ${contractEnd.slice(0, 10)} 内`
                : "先选合同"
            }
          >
            <FormGrid columns={2}>
              <ProFormDatePicker
                name="startDate"
                label="起期"
                rules={[
                  { required: true, message: "请选择起期" },
                  {
                    validator(_: unknown, value: unknown) {
                      if (!contractStart || !value) return Promise.resolve();
                      const v = new Date(value as string).getTime();
                      const s = new Date(contractStart).getTime();
                      if (v < s) {
                        return Promise.reject(new Error("项目起期不能早于合同起期"));
                      }
                      return Promise.resolve();
                    }
                  }
                ]}
                fieldProps={{ size: "large", style: { width: "100%" } }}
              />
              <ProFormDatePicker
                name="endDate"
                label="止期"
                rules={[
                  { required: true, message: "请选择止期" },
                  ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
                    validator(_: unknown, value: unknown) {
                      const start = getFieldValue("startDate") as string | number | Date | null | undefined;
                      if (!value || !start) return Promise.resolve();
                      const d = new Date(value as string).getTime();
                      const s = new Date(start).getTime();
                      if (d <= s) {
                        return Promise.reject(new Error("止期必须晚于起期"));
                      }
                      if (contractEnd && d > new Date(contractEnd).getTime()) {
                        return Promise.reject(new Error("项目止期不能晚于合同止期"));
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
                placeholder="可空;留空表示不单设预算"
                min={0}
                fieldProps={{ size: "large", precision: 2, prefix: "¥", addonAfter: "元" }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              项目默认状态 <Tag color="blue">计划中</Tag>;
              创建后可手动 <Tag>开始</Tag> <Tag>取消</Tag>。
            </Text>
          </Space>
          <SubmitBar
            onSubmit={() => formRef.current?.submit()}
            onCancel={() => router.push("/projects")}
            submitText="创建项目"
          />
        </ProForm>
      </FormCard>
    </Page>
  );
}
