"use client";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App as AntdApp, Button, Tag, Modal, Space } from "antd";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DateTimeCell } from "@/components/table-cells";

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
  lastLoginAt: string | null;
  createdAt: string;
};

export default function UsersPage() {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const { mutate } = useSWRConfig();
  const [resetting, setResetting] = useState<{ id: string; newPassword: string } | null>(null);

  async function onToggleStatus(u: User) {
    const next = u.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    const action = next === "DISABLED" ? "禁用" : "启用";
    modal.confirm({
      title: `${action}账号 ${u.name}?`,
      content: next === "DISABLED" ? "禁用后该账号将无法登录。" : "启用后该账号可正常登录。",
      okType: next === "DISABLED" ? "danger" : "primary",
      onOk: async () => {
        const r = await fetch(`/api/users/${u.id}/toggle-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: next })
        });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        message.success(`${action}成功`);
        mutate((k) => typeof k === "string" && k.startsWith("/api/users"));
      }
    });
  }

  function onResetPassword(u: User) {
    modal.confirm({
      title: `重置 ${u.name} 的密码?`,
      content: "重置后会生成新的随机密码,需要把新密码告知用户。",
      okType: "danger",
      onOk: async () => {
        const r = await fetch(`/api/users/${u.id}/reset-password`, {
          method: "POST",
          credentials: "include"
        });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        setResetting({ id: u.id, newPassword: j.data.newPassword });
        mutate((k) => typeof k === "string" && k.startsWith("/api/users"));
      }
    });
  }

  function onDelete(u: User) {
    modal.confirm({
      title: `删除账号 ${u.name}?`,
      content: "软删:账号将从列表移除,但保留审计日志关联。",
      okType: "danger",
      onOk: async () => {
        const r = await fetch(`/api/users/${u.id}`, { method: "DELETE", credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        message.success("已删除");
        mutate((k) => typeof k === "string" && k.startsWith("/api/users"));
      }
    });
  }

  const columns: ProColumns<User>[] = [
    { title: "工号", dataIndex: "employeeNo", width: 100 },
    { title: "姓名", dataIndex: "name", width: 100 },
    { title: "邮箱", dataIndex: "email", width: 200, ellipsis: true },
    {
      title: "角色",
      dataIndex: ["role", "name"],
      width: 100,
      render: (_, r) => <Tag color="blue">{r.role?.name ?? r.roleId}</Tag>
    },
    { title: "部门", dataIndex: "department", width: 120, render: (_, r) => r.department ?? "-" },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (_, r) => (
        <Tag color={r.status === "ACTIVE" ? "green" : "default"}>
          {r.status === "ACTIVE" ? "启用" : "禁用"}
        </Tag>
      )
    },
    {
      title: "最近登录",
      dataIndex: "lastLoginAt",
      width: 180,
      render: (_, r) => (r.lastLoginAt ? <DateTimeCell value={r.lastLoginAt} /> : "从未登录")
    },
    {
      title: "操作",
      width: 280,
      fixed: "right",
      render: (_, r) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => router.push(`/admin/users/${r.id}`)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => router.push(`/admin/users/${r.id}/edit`)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => onResetPassword(r)}>
            重置密码
          </Button>
          <Button type="link" size="small" onClick={() => onToggleStatus(r)}>
            {r.status === "ACTIVE" ? "禁用" : "启用"}
          </Button>
          <Button type="link" size="small" danger onClick={() => onDelete(r)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title="用户管理"
        subtitle="系统用户、角色与状态;支持按工号/姓名/邮箱/部门搜索"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/admin/users/new")}>
            新建用户
          </Button>
        }
      />
      <ProTable<User>
        rowKey="id"
        columns={columns}
        search={{
          labelWidth: "auto",
          defaultCollapsed: false
        }}
        toolbar={{ settings: [] }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (params.keyword) qs.set("keyword", String(params.keyword));
          if (params.status) qs.set("status", String(params.status));
          if (params.department) qs.set("department", String(params.department));
          const res = await fetch(`/api/users?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
      />

      <Modal
        open={!!resetting}
        title="新密码已生成"
        onCancel={() => setResetting(null)}
        onOk={async () => {
          if (resetting?.newPassword) {
            try {
              await navigator.clipboard.writeText(resetting.newPassword);
              message.success("已复制到剪贴板");
            } catch {
              /* ignore */
            }
          }
          setResetting(null);
        }}
        okText="复制"
        cancelText="关闭"
      >
        <p style={{ marginBottom: 8 }}>请把以下新密码告知用户（关闭后无法再次查看）：</p>
        <div
          style={{
            padding: "12px 16px",
            background: "#fafafa",
            border: "1px solid #d9d9d9",
            borderRadius: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 18,
            letterSpacing: "0.05em",
            userSelect: "all"
          }}
        >
          {resetting?.newPassword}
        </div>
      </Modal>
    </Page>
  );
}
