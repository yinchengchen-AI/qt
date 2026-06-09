"use client";
import dynamic from "next/dynamic";
import { App as AntdApp, Badge, Dropdown, Drawer, List, Empty } from "antd";
import {
  LogoutOutlined,
  UserOutlined,
  BellOutlined,
  DashboardOutlined,
  TeamOutlined,
  FileTextOutlined,
  ProjectOutlined,
  BookOutlined,
  PayCircleOutlined,
  AreaChartOutlined,
  BellOutlined as BellIcon,
  NotificationOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { RoleCode } from "@/types/enums";
import type { Action, Resource } from "@/lib/permissions";
import { QtMark } from "./qt-mark";

const ProLayout = dynamic(
  () => import("@ant-design/pro-components").then((m) => m.ProLayout),
  { ssr: false }
);

type Props = {
  user: {
    id: string;
    employeeNo: string;
    name: string;
    roleCode: RoleCode;
    permissions: { resource: Resource; actions: Action[] }[];
  };
  children: React.ReactNode;
};

const menu = {
  path: "/",
  routes: [
    { path: "/dashboard", name: "工作台", icon: <DashboardOutlined /> },
    { path: "/customers", name: "客户管理", icon: <TeamOutlined /> },
    { path: "/contracts", name: "合同管理", icon: <FileTextOutlined /> },
    { path: "/projects", name: "项目管理", icon: <ProjectOutlined /> },
    { path: "/invoices", name: "开票管理", icon: <BookOutlined /> },
    { path: "/payments", name: "回款管理", icon: <PayCircleOutlined /> },
    {
      path: "/statistics",
      name: "统计分析",
      icon: <AreaChartOutlined />,
      routes: [
        { path: "/statistics/overview", name: "总览" },
        { path: "/statistics/aging", name: "账龄分析" },
        { path: "/statistics/performance", name: "业务员业绩" }
      ]
    },
    { path: "/messages", name: "消息中心", icon: <BellIcon /> },
    { path: "/announcements", name: "公告", icon: <NotificationOutlined /> },
    {
      path: "/admin",
      name: "系统管理",
      icon: <SettingOutlined />,
      routes: [
        { path: "/admin/users", name: "用户管理" },
        { path: "/admin/roles", name: "角色权限" },
        { path: "/admin/dictionaries", name: "数据字典" },
        { path: "/admin/operation-logs", name: "操作日志" }
      ]
    }
  ]
};

const LAYOUT_TOKEN = {
  colorTextMenuSelected: "#0a1c33",
  colorBgMenuItemSelected: "rgba(15, 42, 71, 0.08)",
  colorTextMenuItemHover: "#0f2a47",
  colorTextMenu: "#475569",
  colorTextMenuSecondary: "#94a3b8",
  sider: { colorMenuBackground: "#ffffff" },
  header: { colorBgHeader: "#ffffff" }
};

export function DashboardShell({ user, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { message } = AntdApp.useApp();
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: string; title: string; type: string; readAt: string | null; createdAt: string; link: { kind: string; id: string } | null }>>([]);

  const loadUnread = async () => {
    try {
      const r = await fetch("/api/messages?page=1&pageSize=1&unread=true", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setUnread(j.data.unreadCount);
    } catch {}
  };
  const loadMessages = async () => {
    try {
      const r = await fetch("/api/messages?page=1&pageSize=10", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setMessages(j.data.list);
    } catch {}
  };

  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <ProLayout
      title={false}
      logo={
        <span style={{ display: "inline-flex", alignItems: "center", padding: "0 4px" }}>
          <QtMark size={28} />
        </span>
      }
      layout="mix"
      location={{ pathname }}
      route={menu}
      navTheme="light"
      contentWidth="Fluid"
      fixSiderbar
      onMenuHeaderClick={() => router.push("/dashboard")}
      token={LAYOUT_TOKEN}
      menu={{ type: "group" }}
      actionsRender={() => [
        <Badge key="msg" count={unread} offset={[-4, 4]} size="small">
          <BellOutlined
            style={{ fontSize: 18, cursor: "pointer", color: "var(--qt-text-2)" }}
            onClick={() => {
              setDrawerOpen(true);
              loadMessages();
            }}
          />
        </Badge>
      ]}
      avatarProps={{
        render: () => (
          <Dropdown
            menu={{
              items: [
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "退出登录",
                  onClick: async () => {
                    await signOut({ redirect: false });
                    message.success("已退出");
                    router.push("/login");
                  }
                }
              ]
            }}
          >
            <span style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--qt-text-1)" }}>
              <UserOutlined />
              <span style={{ fontSize: 13 }}>{user.name}</span>
              <span style={{ color: "var(--qt-text-3)", fontSize: 12 }}>({user.roleCode})</span>
            </span>
          </Dropdown>
        )
      }}
    >
      {children}
      <Drawer
        title="消息"
        size="default"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <a
            onClick={async (e) => {
              e.preventDefault();
              const r = await fetch("/api/messages/mark-all-read", { method: "POST", credentials: "include" });
              const j = await r.json();
              if (j.code === 0) {
                setUnread(0);
                loadMessages();
              }
            }}
          >
            全部已读
          </a>
        }
      >
        {messages.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          <List
            dataSource={messages}
            renderItem={(m) => (
              <List.Item
                style={{ background: m.readAt ? undefined : "rgba(245, 158, 11, 0.06)", cursor: m.link ? "pointer" : undefined }}
                onClick={async () => {
                  if (!m.readAt) {
                    await fetch(`/api/messages/${m.id}`, { method: "PATCH", credentials: "include" });
                    setUnread((u) => Math.max(0, u - 1));
                  }
                  if (m.link) {
                    const map: Record<string, string> = { contract: "/contracts", invoice: "/invoices", payment: "/payments", project: "/projects", customer: "/customers" };
                    router.push(`${map[m.link.kind] ?? "/"}/${m.link.id}`);
                    setDrawerOpen(false);
                  }
                }}
              >
                <List.Item.Meta
                  title={m.title}
                  description={
                    <span>
                      <span style={{ marginRight: 8 }}>{m.type}</span>
                      <span style={{ color: "var(--qt-text-3)" }}>{new Date(m.createdAt).toLocaleString("zh-CN")}</span>
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </ProLayout>
  );
}
