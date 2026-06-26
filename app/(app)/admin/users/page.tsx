"use client";
import { ProTable, type ActionType, type ProColumns, type ProFormInstance } from "@ant-design/pro-components";
import { MoreOutlined, ExportOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Tag, Modal, Space, Dropdown, Form, Input, Badge } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
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
  department: { id: string; code: string; name: string } | null;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
};

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  children?: Dept[];
};

function flattenDepts(tree: Dept[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  function walk(nodes: Dept[], path: string[]) {
    for (const n of nodes) {
      const next = [...path, n.name];
      out.push({ id: n.id, label: next.join(" / ") });
      if (n.children?.length) walk(n.children, next);
    }
  }
  walk(tree, []);
  return out;
}

export default function UsersPage() {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const [resetForm] = Form.useForm<{ password: string; confirm: string }>();
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const actionRef = useRef<ActionType>(undefined);
  const formRef = useRef<ProFormInstance>(undefined);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { isMobile } = useResponsive();

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  const handleSearchValuesChange = () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      formRef.current?.submit?.();
    }, 400);
  };

  const { data: expiringResp } = useSWR<{ data: unknown[] }>("/api/certificates/expiring?days=60", async (url: string) => {
    const r = await fetch(url, { credentials: "include" });
    const j = await r.json();
    return j;
  });
  const expiringCount = expiringResp?.data?.length ?? 0;

  const { data: deptResp } = useSWR<{ tree: Dept[] }>(
    "/api/departments?pageSize=500&tree=true&includeInactive=true",
    async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      return j.data ?? { tree: [] };
    }
  );
  const departmentOptions = useMemo(() => flattenDepts(deptResp?.tree ?? []), [deptResp]);
  const departmentValueEnum = useMemo(
    () => Object.fromEntries(departmentOptions.map((d) => [d.id, { text: d.label }] as const)),
    [departmentOptions]
  );

  const statusValueEnum: Record<string, { text: string; status: string }> = {
    ACTIVE: { text: "启用", status: "Success" },
    DISABLED: { text: "禁用", status: "Default" }
  };

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
        actionRef.current?.reloadAndRest?.();
      }
    });
  }

  function onResetPassword(u: User) {
    setResetting({ id: u.id, name: u.name });
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
        actionRef.current?.reloadAndRest?.();
      }
    });
  }

  // ----- 导出 -----
  async function exportUsersToCsv() {
    const values = formRef.current?.getFieldsValue?.() ?? {};
    const qs = new URLSearchParams();
    qs.set("page", "1");
    qs.set("pageSize", "1000");
    if (values.keyword) qs.set("keyword", String(values.keyword));
    if (values.status) qs.set("status", String(values.status));
    if (values.departmentId) qs.set("departmentId", String(values.departmentId));
    const res = await fetch(`/api/users?${qs}`, { credentials: "include" });
    const j = await res.json();
    if (j.code !== 0) throw new Error(j.message);
    const list = (j.data?.list ?? []) as User[];
    const headers = ["工号", "姓名", "邮箱", "角色", "部门", "状态", "最近登录", "创建时间"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = list.map((u) => [
      u.employeeNo,
      u.name,
      u.email,
      u.role?.name ?? "",
      u.department?.name ?? "",
      u.status === "ACTIVE" ? "启用" : "禁用",
      u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-CN") : "",
      new Date(u.createdAt).toLocaleString("zh-CN")
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: ProColumns<User>[] = [
    {
      title: "关键词",
      dataIndex: "keyword",
      hideInTable: true,
      fieldProps: {
        placeholder: "工号 / 姓名 / 邮箱",
        onChange: handleSearchValuesChange
      }
    },
    {
      title: "状态",
      dataIndex: "status",
      hideInTable: true,
      valueType: "select",
      valueEnum: statusValueEnum,
      fieldProps: { allowClear: true, placeholder: "全部", onChange: handleSearchValuesChange }
    },
    {
      title: "部门",
      dataIndex: "departmentId",
      hideInTable: true,
      valueType: "select",
      valueEnum: departmentValueEnum,
      fieldProps: { allowClear: true, placeholder: "全部", showSearch: true, optionFilterProp: "label", onChange: handleSearchValuesChange }
    },
    { title: "工号", dataIndex: "employeeNo", width: 100, search: false },
    { title: "姓名", dataIndex: "name", width: 100, search: false },
    { title: "邮箱", dataIndex: "email", width: 200, ellipsis: true, search: false },
    {
      title: "角色",
      dataIndex: ["role", "name"],
      width: 100,
      search: false,
      render: (_, r) => <Tag color="blue">{r.role?.name ?? r.roleId}</Tag>
    },
    {
      title: "部门",
      dataIndex: ["department", "name"],
      width: 140,
      search: false,
      render: (_, r) => r.department?.name ?? "-"
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      search: false,
      render: (_, r) => <Tag color={r.status === "ACTIVE" ? "green" : "default"}>{r.status === "ACTIVE" ? "启用" : "禁用"}</Tag>
    },
    {
      title: "最近登录",
      dataIndex: "lastLoginAt",
      width: 180,
      search: false,
      render: (_, r) => (r.lastLoginAt ? <DateTimeCell value={r.lastLoginAt} /> : "从未登录")
    },
    {
      title: "操作",
      width: 180,
      fixed: "right",
      search: false,
      render: (_, r) => {
        const moreItems = [
          { key: "reset", label: "重置密码" },
          { key: "toggle", label: r.status === "ACTIVE" ? "禁用" : "启用" },
          { type: "divider" as const },
          { key: "delete", label: <span style={{ color: "var(--qt-danger)" }}>删除</span>, danger: true }
        ];
        return (
          <Space size={4}>
            <Button type="link" size="small" onClick={() => router.push(`/admin/users/${r.id}`)}>详情</Button>
            <Button type="link" size="small" onClick={() => router.push(`/admin/users/${r.id}/edit`)}>编辑</Button>
            <Dropdown
              menu={{ items: moreItems, onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); if (key === "reset") onResetPassword(r); else if (key === "toggle") onToggleStatus(r); else if (key === "delete") onDelete(r); } }}
              trigger={["click"]}
              placement="bottomRight"
            >
              <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
            </Dropdown>
          </Space>
        );
      }
    }
  ];

  return (
    <Page>
      <PageHeader
        title="员工管理"
        subtitle="员工账号、角色与部门;支持按工号/姓名/邮箱/部门/状态搜索"
        actions={
          <Space>
            <Button key="export" icon={<ExportOutlined />} onClick={exportUsersToCsv}>
              导出
            </Button>
            <Button key="certs" onClick={() => router.push("/admin/certificates/expiring")}>
              到期证书
              {expiringCount > 0 && <Badge count={expiringCount} offset={[8, -4]} style={{ backgroundColor: "#ff4d4f" }} />}
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/admin/users/new")}>
              新建员工
            </Button>
          </Space>
        }
      />

      <ProTable<User>
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined, collapsed: isMobile ? false : undefined }}
        debounceTime={400}
        scroll={{ x: "max-content" }}
        cardBordered={false}
        sticky={isMobile}
        options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile, fullScreen: !isMobile }}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (params.keyword) qs.set("keyword", String(params.keyword));
          if (params.status) qs.set("status", String(params.status));
          if (params.departmentId) qs.set("departmentId", String(params.departmentId));
          const res = await fetch(`/api/users?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
      />

      <Modal
        open={!!resetting}
        title={resetting ? `重置 ${resetting.name} 的密码` : "重置密码"}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: resetSubmitting }}
        destroyOnClose
        maskClosable={false}
        onCancel={() => { if (resetSubmitting) return; setResetting(null); }}
        onOk={async () => {
          try {
            const values = await resetForm.validateFields();
            setResetSubmitting(true);
            const r = await fetch(`/api/users/${resetting!.id}/reset-password`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ password: values.password })
            });
            const j = await r.json();
            if (j.code !== 0) { message.error(j.message); return; }
            message.success(`已重置 ${resetting!.name} 的密码`);
            setResetting(null);
            actionRef.current?.reloadAndRest?.();
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
            message.error(e instanceof Error ? e.message : "重置失败");
          } finally { setResetSubmitting(false); }
        }}
      >
        <p style={{ marginBottom: 12, color: "var(--qt-text-muted)" }}>
          请输入新的登录密码。设置后旧密码立即失效,已登录会话会要求重新登录。
        </p>
        <Form form={resetForm} layout="vertical" preserve={false} requiredMark={false}>
          <Form.Item name="password" label="新密码" rules={[
            { required: true, message: "请输入新密码" },
            { min: 8, message: "密码至少 8 个字符" },
            { max: 72, message: "密码不能超过 72 个字符" }
          ]}>
            <Input.Password autoFocus placeholder="8 ~ 72 个字符,建议使用密码管理器生成" size="large" maxLength={72} />
          </Form.Item>
          <Form.Item name="confirm" label="确认新密码" dependencies={["password"]} rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) return Promise.resolve();
                return Promise.reject(new Error("两次输入的密码不一致"));
              }
            })
          ]}>
            <Input.Password placeholder="再输入一次" size="large" />
          </Form.Item>
        </Form>
      </Modal>

    </Page>
  );
}
