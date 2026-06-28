"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ProCard, ProForm, ProFormText, ProFormTextArea } from "@ant-design/pro-components";
import { App as AntdApp, Button, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { useState } from "react";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { PermissionMatrix, type Permission } from "@/components/admin/permission-matrix";

const { Text } = Typography;

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
};

export default function EditRolePage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/admin/roles");
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<Role>(`/api/roles/${id}`);
  const [permissions, setPermissions] = useState<Permission[] | null>(null);

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={goBack} title="编辑角色" subtitle="可修改名称、说明与权限矩阵；保存后立即生效" />
        <FormPageSkeleton />
      </Page>
    );
  }

  const currentPerms = permissions ?? data.permissions;

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title={`编辑 ${data.name}`}
        subtitle="可修改名称、说明与权限矩阵；保存后立即生效"
        meta={data.isSystem ? <Tag color="blue">系统角色</Tag> : <Tag>自定义角色</Tag>}
      />
      <ProCard>
        <ProForm
          layout="vertical"
          submitter={false}
          initialValues={{
            code: data.code,
            name: data.name,
            description: data.description ?? ""
          }}
          onFinish={async (values) => {
            const res = await fetch(`/api/roles/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ ...values, permissions: currentPerms })
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("角色已保存");
            router.push(`/admin/roles/${id}`);
            return true;
          }}
        >
          <ProFormText
            name="code"
            label="代码"
            rules={[{ max: 40, pattern: /^[A-Z][A-Z0-9_]*$/ }]}
            extra="系统角色代码可改,但仍保留 isSystem 标识"
          />
          <ProFormText name="name" label="名称" rules={[{ required: true, max: 40 }]} />
          <ProFormTextArea name="description" label="说明" fieldProps={{ maxLength: 200 }} />

          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <Text strong>权限矩阵</Text>
            <div style={{ marginTop: 8 }}>
              <PermissionMatrix value={currentPerms} onChange={setPermissions} />
            </div>
          </div>

          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </ProForm>
      </ProCard>
    </Page>
  );
}
