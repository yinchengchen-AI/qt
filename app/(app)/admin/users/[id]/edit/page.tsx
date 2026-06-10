"use client";
import { ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Card, Space, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";
import { FormPageSkeleton } from "@/components/form-page-skeleton";

const { Text } = Typography;

type Role = { id: string; code: string; name: string };
type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  role: Role;
  department: string | null;
  status: "ACTIVE" | "DISABLED";
};

export default function EditUserPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<User>(`/api/users/${id}`);
  const { data: rolesResp } = useSWR<{ data: { list: Role[] } }>("/api/roles?pageSize=100");
  const roleOptions = (rolesResp?.data?.list ?? []).map((r) => ({
    value: r.id,
    label: `${r.name} (${r.code})`
  }));

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑用户" />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/admin/users/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle={`工号 ${data.employeeNo} 不可改;不能改/禁自己(后端护栏)`}
      />
      <FormCard headerHint={'如忘记密码,请回列表点「重置密码」按钮(后端生成随机密码一次性展示)'}>
        <ProForm
          layout="vertical"
          initialValues={{
            name: data.name,
            email: data.email,
            phone: data.phone ?? undefined,
            roleId: data.roleId,
            department: data.department ?? undefined,
            status: data.status
          }}
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存" },
            resetButtonProps: { style: { display: "none" } }
          }}
          onFinish={async (values) => {
            const res = await fetch(`/api/users/${id}`, {
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
            router.push(`/admin/users/${id}`);
            return true;
          }}
        >
          <FormSection title="账号信息">
            <FormGrid columns={2}>
              <ProFormText
                name="name"
                label="姓名"
                rules={[{ required: true, max: 40 }]}
                fieldProps={{ size: "large", maxLength: 40 }}
              />
              <ProFormText
                name="email"
                label="邮箱"
                rules={[{ required: true, type: "email", max: 120 }]}
                fieldProps={{ size: "large", maxLength: 120 }}
              />
              <ProFormText
                name="phone"
                label="手机号"
                fieldProps={{ size: "large", maxLength: 20 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="角色与部门">
            <FormGrid columns={2}>
              <ProFormSelect
                name="roleId"
                label="角色"
                options={roleOptions}
                showSearch
                rules={[{ required: true }]}
                fieldProps={{ size: "large", optionFilterProp: "label" }}
              />
              <DepartmentTreeSelect
                label="部门"
              />
            </FormGrid>
          </FormSection>

          <FormSection title="状态">
            <FormGrid columns={1}>
              <ProFormSelect
                name="status"
                label="账号状态"
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "DISABLED", label: "禁用" }
                ]}
                rules={[{ required: true }]}
                fieldProps={{ size: "large" }}
              />
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  最后一位 <Tag color="blue">ADMIN</Tag> 不可禁用;自己不可改/禁(后端护栏)
                </Text>
              </Space>
            </FormGrid>
          </FormSection>
        </ProForm>
      </FormCard>
    </Page>
  );
}
