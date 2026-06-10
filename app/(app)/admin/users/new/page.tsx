"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ProCard, ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Button } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";

type Role = { id: string; code: string; name: string };

export default function NewUserPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  // 拉所有角色供下拉（依赖 commit 3 的 /api/roles）
  const { data: rolesResp } = useSWR<{ data: { list: Role[] } }>("/api/roles?pageSize=100");
  const roleOptions = (rolesResp?.data?.list ?? []).map((r) => ({
    value: r.id,
    label: `${r.name} (${r.code})`
  }));

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/admin/users")}
        title="新建用户"
        subtitle="新建账号默认密码 123456,可在列表中重置"
      />
      <ProCard>
        <ProForm
          layout="vertical"
          submitter={false}
          initialValues={{ status: "ACTIVE" }}
          onFinish={async (values) => {
            const res = await fetch("/api/users", {
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
            router.push(`/admin/users/${j.data.id}`);
            return true;
          }}
        >
          <ProFormText name="employeeNo" label="工号" rules={[{ required: true, max: 40 }]} />
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
            label="初始状态"
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
