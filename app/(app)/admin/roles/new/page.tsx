"use client";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ProCard, ProForm, ProFormText, ProFormTextArea } from "@ant-design/pro-components";
import { App as AntdApp, Button, Card, Select, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PermissionMatrix, type Permission } from "@/components/admin/permission-matrix";
import { ROLE_LABEL } from "@/lib/status";

const { Text } = Typography;

const TEMPLATE_OPTIONS = [
  { value: "ADMIN", label: "复制管理员权限（只读系统角色）" },
  { value: "SALES", label: "复制业务人员权限" },
  { value: "FINANCE", label: "复制财务人员权限" },
  { value: "OPS", label: "复制行政人员权限" },
  { value: "EMPTY", label: "空白（自定义）" }
];

export default function NewRolePage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const [permissions, setPermissions] = useState<Permission[]>([]);

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/admin/roles")}
        title="新建角色"
        subtitle="自定义角色（非系统角色）"
      />
      <ProCard>
        <ProForm
          layout="vertical"
          submitter={false}
          initialValues={{ template: "EMPTY" }}
          onFinish={async (values) => {
            if (permissions.length === 0) {
              message.error("至少配置 1 个资源的权限");
              return false;
            }
            const res = await fetch("/api/roles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ ...values, permissions })
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("创建成功");
            router.push(`/admin/roles/${j.data.id}`);
            return true;
          }}
        >
          <ProFormText
            name="code"
            label="代码"
            tooltip="大写字母/数字/下划线,以大写字母开头;创建后仍可改"
            rules={[{ required: true, max: 40, pattern: /^[A-Z][A-Z0-9_]*$/ }]}
          />
          <ProFormText name="name" label="名称" rules={[{ required: true, max: 40 }]} />
          <ProFormTextArea name="description" label="说明" fieldProps={{ maxLength: 200 }} />

          <Card size="small" style={{ marginBottom: 16, background: "#fafafa" }}>
            <Text strong>从模板复制（可选）</Text>
            <div style={{ marginTop: 8 }}>
              <Select
                defaultValue="EMPTY"
                style={{ width: 320 }}
                options={TEMPLATE_OPTIONS}
                onChange={(v) => {
                  if (v === "EMPTY") {
                    setPermissions([]);
                    return;
                  }
                  // 拉对应角色的权限填进 form
                  fetch(`/api/roles?keyword=${v}&pageSize=1`, { credentials: "include" })
                    .then((res) => res.json())
                    .then((j) => {
                      const r = j.data?.list?.[0];
                      if (r) setPermissions(r.permissions);
                    });
                }}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>基于某个系统角色的默认权限快速起步</Text>
          </Card>

          <div style={{ marginBottom: 16 }}>
            <Text strong>权限矩阵</Text>
            <div style={{ marginTop: 8 }}>
              <PermissionMatrix value={permissions} onChange={setPermissions} />
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
