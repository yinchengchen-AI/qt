"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Badge,
  Drawer,
  List,
  Empty,
  Tooltip,
  Typography,
  theme,
  type MenuProps
} from "antd";
import {
  LogoutOutlined,
  BellOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  TeamOutlined,
  FileTextOutlined,
  ProjectOutlined,
  BookOutlined,
  PayCircleOutlined,
  AreaChartOutlined,
  NotificationOutlined,
  SettingOutlined,
  UserOutlined,
  DownOutlined,
  CompressOutlined,
  ExpandOutlined
} from "@ant-design/icons";
import type { RoleCode } from "@/types/enums";
import type { Action, Resource } from "@/lib/permissions";

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

type MenuItem = {
  path: string;
  name: string;
  icon?: React.ReactNode;
  children?: Omit<MenuItem, "children">[];
};

const MENU: MenuItem[] = [
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
    children: [
      { path: "/statistics/overview", name: "总览" },
      { path: "/statistics/aging", name: "账龄分析" },
      { path: "/statistics/performance", name: "业务员业绩" }
    ]
  },
  { path: "/messages", name: "消息中心", icon: <BellOutlined /> },
  { path: "/announcements", name: "公告", icon: <NotificationOutlined /> },
  {
    path: "/admin",
    name: "系统管理",
    icon: <SettingOutlined />,
    children: [
      { path: "/admin/users", name: "用户管理" },
      { path: "/admin/roles", name: "角色权限" },
      { path: "/admin/departments", name: "部门管理" },
      { path: "/admin/dictionaries", name: "数据字典" },
      { path: "/admin/operation-logs", name: "操作日志" }
    ]
  }
];

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

function findSelectedKey(pathname: string): { key: string; open: string[] } {
  for (const item of MENU) {
    if (item.path === pathname) return { key: item.path, open: [] };
    if (item.children?.some((c) => pathname.startsWith(c.path))) {
      return { key: pathname, open: [item.path] };
    }
  }
  return { key: pathname, open: [] };
}

function toAntdMenu(items: MenuItem[]): MenuProps["items"] {
  return items.map((item) => {
    const label =
      item.children && item.children.length > 0 ? (
        item.name
      ) : (
        <Link href={item.path}>{item.name}</Link>
      );
    const node: NonNullable<MenuProps["items"]>[number] = {
      key: item.path,
      icon: item.icon as React.ReactNode,
      label
    };
    if (item.children?.length) {
      (node as { children?: NonNullable<MenuProps["items"]>[number][] }).children =
        item.children.map((c) => ({
          key: c.path,
          label: <Link href={c.path}>{c.name}</Link>
        }));
    }
    return node;
  });
}

const ROLE_LABEL: Record<RoleCode, string> = {
  ADMIN: "管理员",
  SALES: "业务人员",
  FINANCE: "财务人员",
  OPS: "行政人员"
};

export function DashboardShell({ user, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  // 手风琴模式: 仅同时打开一个父分组(默认开);关闭后允许多个分组同时展开
  const [accordion, setAccordion] = useState(true);
  // 父分组展开状态(controlled, 用于支持手风琴/多开切换)
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ id: string; title: string; type: string; readAt: string | null; createdAt: string; link: { kind: string; id: string } | null }>
  >([]);

  const { key: selectedKey, open: defaultOpen } = useMemo(
    () => findSelectedKey(pathname),
    [pathname]
  );

  // 读取持久化的手风琴设置
  useEffect(() => {
    try {
      const raw = localStorage.getItem("qt.sidebar.accordion");
      if (raw === "false") setAccordion(false);
    } catch {
      /* SSR or storage blocked */
    }
  }, []);

  // 切换时落盘
  useEffect(() => {
    try {
      localStorage.setItem("qt.sidebar.accordion", String(accordion));
    } catch {
      /* ignore */
    }
  }, [accordion]);

  // 路由变化时,把当前页所在父分组纳入 openKeys
  useEffect(() => {
    if (defaultOpen.length === 0) return;
    setOpenKeys((prev) => {
      const missing = defaultOpen.filter((k) => !prev.includes(k));
      if (missing.length === 0) return prev;
      return accordion ? defaultOpen : [...prev, ...defaultOpen];
    });
  }, [defaultOpen, accordion]);

  const handleOpenChange = (keys: string[]) => {
    if (!accordion) {
      setOpenKeys(keys);
      return;
    }
    // 手风琴: 仅保留最新打开的那一个;关闭操作照常放行
    const newlyOpened = keys.filter((k) => !openKeys.includes(k));
    setOpenKeys(newlyOpened.length > 0 ? newlyOpened : keys);
  };

  const loadUnread = async () => {
    try {
      const r = await fetch("/api/messages?page=1&pageSize=1&unread=true", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setUnread(j.data.unreadCount);
    } catch {
      /* ignore */
    }
  };
  const loadMessages = async () => {
    try {
      const r = await fetch("/api/messages?page=1&pageSize=10", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setMessages(j.data.list);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 60000);
    return () => clearInterval(t);
  }, []);

  const userMenu: MenuProps["items"] = [
    {
      key: "role",
      label: (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {ROLE_LABEL[user.roleCode] ?? user.roleCode} · {user.employeeNo}
        </Text>
      ),
      disabled: true
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      onClick: async () => {
        await signOut({ redirect: false });
        router.push("/login");
      }
    }
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={232}
        collapsedWidth={64}
        collapsed={collapsed}
        trigger={null}
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          borderRight: `1px solid ${token.colorSplit}`,
          background: token.colorBgContainer
        }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: `1px solid ${token.colorSplit}`,
            overflow: "hidden",
            flexShrink: 0
          }}
        >
          {collapsed ? (
            <span
              aria-label="企泰安全"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "linear-gradient(135deg, #0A1C33 0%, #142E63 100%)",
                color: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.02em"
              }}
            >
              企
            </span>
          ) : (
            <Link
              href="/dashboard"
              aria-label="企泰安全"
              style={{
                textDecoration: "none",
                color: token.colorText,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.12em"
              }}
            >
              企泰安全
            </Link>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={handleOpenChange}
          items={toAntdMenu(MENU)}
          style={{ borderInlineEnd: 0, paddingTop: 8 }}
          onClick={(e) => {
            if (typeof e.key === "string" && e.key.startsWith("/")) router.push(e.key);
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: 36,
            left: 0,
            right: 0,
            padding: "8px 12px",
            borderTop: `1px solid ${token.colorSplit}`,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            gap: 8
          }}
        >
          <Tooltip
            placement="right"
            title={accordion ? "手风琴模式:同时仅打开一个分组(点击切换为多开)" : "多开模式:允许多个分组同时展开(点击切换为手风琴)"}
          >
            <button
              type="button"
              onClick={() => setAccordion((a) => !a)}
              aria-label={accordion ? "关闭手风琴" : "开启手风琴"}
              aria-pressed={accordion}
              style={{
                background: accordion ? token.colorPrimaryBg : "transparent",
                border: `1px solid ${accordion ? token.colorPrimaryBorder : token.colorSplit}`,
                padding: collapsed ? "6px 8px" : "4px 10px",
                cursor: "pointer",
                color: accordion ? token.colorPrimary : token.colorTextSecondary,
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 6,
                transition: "background-color 160ms, border-color 160ms, color 160ms",
                width: collapsed ? "auto" : "100%",
                justifyContent: collapsed ? "center" : "flex-start"
              }}
            >
              {accordion ? <CompressOutlined /> : <ExpandOutlined />}
              {!collapsed && <span>{accordion ? "手风琴" : "多开"}</span>}
            </button>
          </Tooltip>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "8px 20px",
            borderTop: `1px solid ${token.colorSplit}`,
            fontSize: 12,
            color: token.colorTextTertiary
          }}
        >
          v 0.1.0 · 内部系统
        </div>
      </Sider>

      <Layout style={{ background: token.colorBgLayout }}>
        <Header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px 0 8px",
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorSplit}`
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
              flex: 1
            }}
          >
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              title={collapsed ? "展开侧栏" : "收起侧栏"}
              style={{
                background: "transparent",
                border: "none",
                padding: 6,
                cursor: "pointer",
                color: token.colorTextSecondary,
                fontSize: 16,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                transition: "background-color 160ms"
              }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            <span
              aria-hidden="true"
              style={{
                width: 1,
                height: 20,
                background: token.colorSplit,
                flexShrink: 0
              }}
            />
            <Crumbs pathname={pathname} />
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
            <Badge count={unread} size="small" offset={[-2, 2]}>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(true);
                  loadMessages();
                }}
                aria-label="消息"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 6,
                  cursor: "pointer",
                  color: token.colorTextSecondary,
                  fontSize: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <BellOutlined />
              </button>
            </Badge>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
            <Dropdown menu={{ items: userMenu }} trigger={["click"]} placement="bottomRight">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 6,
                  transition: "background-color 160ms"
                }}
              >
                <Avatar size={28} icon={<UserOutlined />} style={{ background: token.colorPrimary }}>
                  {user.name?.[0]}
                </Avatar>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <Text style={{ fontSize: 13 }}>{user.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {ROLE_LABEL[user.roleCode] ?? user.roleCode}
                  </Text>
                </span>
                <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
              </span>
            </Dropdown>
          </div>
        </Header>

        <Content
          key={pathname}
          className="app-anim-in"
          style={{
            padding: 24,
            minHeight: "calc(100vh - 64px)"
          }}
        >
          {children}
        </Content>
      </Layout>

      <Drawer
        title="消息中心"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="default"
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
            style={{ color: token.colorPrimary, fontSize: 13 }}
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
                style={{
                  background: m.readAt ? undefined : token.colorPrimaryBg,
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 6,
                  cursor: m.link ? "pointer" : undefined,
                  border: "none",
                  transition: "background-color 160ms"
                }}
                onClick={async () => {
                  if (!m.readAt) {
                    await fetch(`/api/messages/${m.id}`, { method: "PATCH", credentials: "include" });
                    setUnread((u) => Math.max(0, u - 1));
                  }
                  if (m.link) {
                    const map: Record<string, string> = {
                      contract: "/contracts",
                      invoice: "/invoices",
                      payment: "/payments",
                      project: "/projects",
                      customer: "/customers"
                    };
                    router.push(`${map[m.link.kind] ?? "/"}/${m.link.id}`);
                    setDrawerOpen(false);
                  }
                }}
              >
                <List.Item.Meta
                  title={<span style={{ fontSize: 13, fontWeight: 500 }}>{m.title}</span>}
                  description={
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                      <span style={{ marginRight: 8 }}>{m.type}</span>
                      <span>{new Date(m.createdAt).toLocaleString("zh-CN")}</span>
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </Layout>
  );
}

const CRUMB_LABEL: Record<string, string> = {
  dashboard: "工作台",
  customers: "客户管理",
  contracts: "合同管理",
  projects: "项目管理",
  invoices: "开票管理",
  payments: "回款管理",
  statistics: "统计分析",
  overview: "总览",
  aging: "账龄分析",
  performance: "业务员业绩",
  messages: "消息中心",
  announcements: "公告",
  admin: "系统管理",
  users: "用户管理",
  roles: "角色权限",
  departments: "部门管理",
  dictionaries: "数据字典",
  "operation-logs": "操作日志",
  new: "新建",
  edit: "编辑"
};

function Crumbs({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return <Text type="secondary">工作台</Text>;
  }
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? (
            <Text type="secondary" style={{ margin: "0 6px" }}>
              /
            </Text>
          ) : null}
          <Text type={i === parts.length - 1 ? undefined : "secondary"}>
            {CRUMB_LABEL[p] ?? p}
          </Text>
        </span>
      ))}
    </span>
  );
}
