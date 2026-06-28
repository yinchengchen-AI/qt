"use client";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { App as AntdApp, Button, Tag, Space } from "antd";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
import { PageHeader } from "@/components/page-header";
import { PermissionMatrix, type Permission } from "@/components/admin/permission-matrix";

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  userCount: number;
  createdAt: string;
};

export default function RolesPage() {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const { isMobile } = useResponsive();

  function onDelete(r: Role) {
    modal.confirm({
      title: `删除角色 ${r.name}?`,
      content: r.userCount > 0
        ? `该角色仍有 ${r.userCount} 个用户,无法删除。`
        : "硬删:该角色将从数据库移除。",
      okType: "danger",
      okButtonProps: r.userCount > 0 ? { disabled: true } : undefined,
      onOk: async () => {
        const res = await fetch(`/api/roles/${r.id}`, { method: "DELETE", credentials: "include" });
        const j = await res.json();
        if (j.code !== 0) return message.error(j.message);
        message.success("角色已删除");
        actionRef.current?.reloadAndRest?.();
      }
    });
  }

  const columns: ProColumns<Role>[] = [
    { title: "代码", dataIndex: "code", width: 100 },
    { title: "名称", dataIndex: "name", width: 120 },
    {
      title: "类型",
      dataIndex: "isSystem",
      width: 100,
      render: (_, r) =>
        r.isSystem ? <Tag color="blue">系统</Tag> : <Tag>自定义</Tag>
    },
    {
      title: "权限数",
      width: 100,
      render: (_, r) => `${r.permissions.length} 资源`
    },
    {
      title: "用户数",
      dataIndex: "userCount",
      width: 100,
      render: (_: unknown, r: Role) => <Tag color={r.userCount > 0 ? "green" : "default"}>{r.userCount}</Tag>
    },
    {
      title: "说明",
      dataIndex: "description",
      ellipsis: true,
      render: (_: unknown, r: Role) => r.description ?? "-"
    },
    {
      title: "操作",
      width: 220,
      fixed: "right",
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => router.push(`/admin/roles/${r.id}`)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => router.push(`/admin/roles/${r.id}/edit`)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            disabled={r.isSystem}
            onClick={() => onDelete(r)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title="角色权限"
        subtitle="系统内置 4 个角色 + 自定义角色；权限矩阵覆盖 12 类资源 × 6 种操作"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/admin/roles/new")}>
            新建角色
          </Button>
        }
      />
      <ProTable<Role> actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined, collapsed: isMobile ? false : undefined }} debounceTime={400}
        scroll={{ x: 'max-content' }}
        cardBordered={false}
        sticky={isMobile}
        options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile, fullScreen: !isMobile }}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (params.keyword) qs.set("keyword", String(params.keyword));
          const res = await fetch(`/api/roles?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        expandable={{
          expandedRowRender: (r) => (
            <div style={{ padding: 8 }}>
              <PermissionMatrix value={r.permissions} readOnly />
            </div>
          )
        }}
      />
    </Page>
  );
}
