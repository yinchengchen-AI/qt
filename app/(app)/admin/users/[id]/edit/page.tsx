"use client";
import { ProForm, ProFormText, ProFormSelect, ProCard } from "@ant-design/pro-components";
import { App as AntdApp, Button, Alert, Space } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormGrid } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { ErrorBox } from "@/components/callout";

type Role = { id: string; code: string; name: string };

type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  role: Role;
  departmentId: string | null;
  department: { id: string; code: string; name: string } | null;
  status: "ACTIVE" | "DISABLED";
};

// P0-4: 旧 edit 页缩成账号信息编辑(name/email/phone/role/department/status)。
// 档案编辑走 /admin/users/[id]/edit-profile(PR4 5 步向导)。
export default function EditUserPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();

  const { data: userResp, error, isLoading } = useSWR<User>(`/api/users/${id}`);
  const { data: rolesResp } = useSWR<{ list: Role[] }>("/api/roles?pageSize=100");
  
  if (error) {
    return (
      <Page>
        <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑账号" />
        <ErrorBox title="加载失败">{(error as Error).message}</ErrorBox>
      </Page>
    );
  }
  if (isLoading || !userResp) {
    return (
      <Page>
        <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑账号" />
        <FormPageSkeleton />
      </Page>
    );
  }

  const user = userResp;
  const roleOptions = (rolesResp?.list ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));

  return (
    <Page>
      <PageHeader
        back={() => router.push(`/admin/users/${id}`)}
        title={`编辑账号 — ${user.name} (${user.employeeNo})`}
        subtitle="工号 / 邮箱全局唯一;角色决定权限矩阵"
      />

      <Alert
        message="档案编辑已迁移"
        description={
          <Space direction="vertical" size="small">
            <span>本页只编辑账号信息(姓名/邮箱/手机/角色/部门/状态)。</span>
            <span>员工档案(基础/岗位合同/敏感/履历/证书与附件)请用 5 步向导编辑。</span>
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => router.push(`/admin/users/${id}/edit-profile`)}
            >
              打开档案向导
            </Button>
          </Space>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <ProForm
        layout="vertical"
        submitter={{
          searchConfig: { resetText: "重置", submitText: "保存" },
          resetButtonProps: { style: { display: "none" } }
        }}
        initialValues={{
          name: user.name,
          employeeNo: user.employeeNo,
          email: user.email,
          phone: user.phone ?? undefined,
          roleId: user.roleId,
          departmentId: user.departmentId ?? undefined,
          status: user.status
        }}
        onFinish={async (values) => {
          const payload = {
            name: values.name,
            email: values.email,
            phone: values.phone || null,
            roleId: values.roleId,
            departmentId: values.departmentId || null,
            status: values.status
          };
          const res = await fetch(`/api/users/${id}`, {
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
          router.push(`/admin/users/${id}`);
          return true;
        }}
      >
        <ProCard title="账号信息" style={{ marginBottom: 16 }}>
          <FormGrid columns={2}>
            <ProFormText
              name="name"
              label="姓名"
              rules={[{ required: true, max: 40, message: "姓名必填" }]}
              fieldProps={{ size: "large", maxLength: 40, showCount: true }}
              disabled
            />
            <ProFormText
              name="employeeNo"
              label="工号"
              tooltip="工号不能修改"
              fieldProps={{ size: "large", disabled: true }}
            />
            <ProFormText
              name="email"
              label="邮箱"
              rules={[
                { required: true, type: "email", message: "请输入正确邮箱" },
                { max: 120 }
              ]}
              fieldProps={{ size: "large", maxLength: 120 }}
            />
            <ProFormText
              name="phone"
              label="手机号"
              fieldProps={{ size: "large", maxLength: 20 }}
            />
          </FormGrid>
        </ProCard>

        <ProCard title="角色与部门" style={{ marginBottom: 16 }}>
          <FormGrid columns={2}>
            <ProFormSelect
              name="roleId"
              label="角色"
              placeholder="请选择"
              options={roleOptions}
              rules={[{ required: true, message: "请选择角色" }]}
            />
            <DepartmentTreeSelect label="部门" placeholder="不选 = 无部门" />
          </FormGrid>
        </ProCard>

        <ProCard title="账号状态" style={{ marginBottom: 16 }}>
          <ProFormSelect
            name="status"
            label="状态"
            options={[
              { value: "ACTIVE", label: "启用" },
              { value: "DISABLED", label: "禁用" }
            ]}
            rules={[{ required: true }]}
          />
        </ProCard>
      </ProForm>
    </Page>
  );
}
