"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ProCard, ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { FormPageSkeleton } from "@/components/form-page-skeleton";

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
        <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑用户" subtitle="修改用户基础信息、角色与状态" />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/admin/users/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle="修改用户基础信息、角色与状态"
      />
      <ProCard>
        <ProForm
          layout="vertical"
          submitter={false}
          initialValues={{
            name: data.name,
            email: data.email,
            phone: data.phone ?? "",
            roleId: data.roleId,
            department: data.department ?? "",
            status: data.status
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
            message.success("保存成功");
            router.push(`/admin/users/${id}`);
            return true;
          }}
        >
          <ProFormText name="name" label="姓名" rules={[{ required: true, max: 40 }]} />
          <ProFormText name="email" label="邮箱" rules={[{ required: true, type: "email", max: 120 }]} />
          <ProFormText name="phone" label="手机号" />
          <ProFormSelect
            name="roleId"
            label="角色"
            rules={[{ required: true }]}
            options={roleOptions}
            showSearch
          />
          <ProFormText name="department" label="部门" />
          <ProFormSelect
            name="status"
            label="状态"
            options={[
              { value: "ACTIVE", label: "启用" },
              { value: "DISABLED", label: "禁用" }
            ]}
          />
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </ProForm>
      </ProCard>
    </Page>
  );
}
