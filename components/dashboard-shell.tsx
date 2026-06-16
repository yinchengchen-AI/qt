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
  Empty,
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
  PlayCircleOutlined,
  AreaChartOutlined,
  SettingOutlined,
  UserOutlined,
  DownOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  AccountBookOutlined,
  IdcardOutlined,
} from "@ant-design/icons";
import type { RoleCode } from "@/types/enums";
import type { Action, Resource } from "@/lib/permissions";
import { useResponsive } from "@/lib/use-breakpoint";
import { ROLE_LABEL } from "@/lib/status";

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
  {
    path: "/customers",
    name: "业务",
    icon: <AppstoreOutlined />,
    children: [
      { path: "/customers", name: "客户管理" },
      { path: "/contracts", name: "合同管理" },
      { path: "/projects", name: "项目管理" }
    ]
  },
  { path: "/assets", name: "企业资产", icon: <DatabaseOutlined /> },
  { path: "/workflow", name: "我的工作流", icon: <PlayCircleOutlined /> },
  {
    path: "/invoices",
    name: "财务",
    icon: <AccountBookOutlined />,
    children: [
      { path: "/invoices", name: "开票管理" },
      { path: "/payments", name: "回款管理" }
    ]
  },
  {
    path: "/statistics",
    name: "统计分析",
    icon: <AreaChartOutlined />,
    children: [
      { path: "/statistics/overview", name: "总览" },
      { path: "/statistics/aging", name: "账龄分析" },
      { path: "/statistics/performance", name: "业务员业绩" },
      { path: "/statistics/workflow", name: "工作流概览" },
      { path: "/workflow/follow-ups", name: "跟进 360" }
    ]
  },
  {
    path: "/messages",
    name: "消息与公告",
    icon: <BellOutlined />,
    children: [
      { path: "/messages", name: "消息中心" },
      { path: "/announcements", name: "公告" }
    ]
  },
  {
    path: "/admin/users",
    name: "员工管理",
    icon: <IdcardOutlined />,
    children: [
      { path: "/admin/users", name: "员工列表" },
      { path: "/admin/roles", name: "角色权限" },
      { path: "/admin/departments", name: "部门管理" }
    ]
  },
  {
    path: "/admin/dictionaries",
    name: "系统",
    icon: <SettingOutlined />,
    children: [
      { path: "/admin/dictionaries", name: "数据字典" },
      { path: "/admin/operation-logs", name: "操作日志" },
      { path: "/admin/workflow-templates", name: "工作流模板" },
      { path: "/admin/trash", name: "回收站" }
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
      key: item.children?.length ? `${item.path}__group` : item.path,
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

export function DashboardShell({ user, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { token } = theme.useToken();
  const { isMobile, isPhone, md } = useResponsive();
  const [collapsed, setCollapsed] = useState(false);
  // 父分组展开状态(controlled, 手风琴: 仅同时打开一个父分组)
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ id: string; title: string; type: string; readAt: string | null; createdAt: string; link: { kind: string; id: string } | null }>
  >([]);

  const { key: selectedKey, open: defaultOpen } = useMemo(
    () => findSelectedKey(pathname),
    [pathname]
  );

  // 移动端在 body 上挂 .qt-touch 标记,样式 hook 用来收紧菜单交互与按钮尺寸
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("qt-touch", isMobile);
    return () => {
      document.body.classList.remove("qt-touch");
    };
  }, [isMobile]);


  // 路由变化时,把当前页所在父分组纳入 openKeys
  useEffect(() => {
    if (defaultOpen.length === 0) return;
    setOpenKeys((prev) => {
      const missing = defaultOpen.filter((k) => !prev.includes(k));
      if (missing.length === 0) return prev;
      return defaultOpen;
    });
  }, [defaultOpen]);

  // 移动端路由切换时自动关闭导航 Drawer
  useEffect(() => {
    if (isMobile) setNavOpen(false);
  }, [pathname, isMobile]);

  const handleOpenChange = (keys: string[]) => {
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

  // 桌面端 Sider 节点;移动端不渲染,改用下方 Drawer
  const siderNode = (
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

    </Sider>
  );

  // 移动端导航 Drawer 共用一份 Menu
  const mobileMenu = (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      openKeys={openKeys}
      onOpenChange={handleOpenChange}
      items={toAntdMenu(MENU)}
      style={{ borderInlineEnd: 0 }}
      onClick={(e) => {
        if (typeof e.key === "string" && e.key.startsWith("/")) {
          setNavOpen(false);
          router.push(e.key);
        }
      }}
    />
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* 桌面端 Sider: >=md 显示 */}
      {md && siderNode}

      {/* 移动端导航 Drawer */}
      {!md && (
        <Drawer
          placement="left"
          open={navOpen}
          onClose={() => setNavOpen(false)}
          styles={{
            wrapper: { width: typeof window !== "undefined" ? Math.min(320, window.innerWidth * 0.85) : 320 },
            body: { padding: 0 },
            header: { display: "none" }
          }}
          rootClassName="qt-nav-drawer"
          // 物理返回键 / Esc 关闭交给 Antd 默认行为
        >
          <div
            style={{
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: `1px solid ${token.colorSplit}`,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.12em"
            }}
          >
            企泰安全
          </div>
          {mobileMenu}
        </Drawer>
      )}

      <Layout style={{ background: token.colorBgLayout }}>
        <Header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: isMobile ? "0 8px 0 4px" : "0 20px 0 8px",
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorSplit}`,
            // iOS 安全区适配
            paddingTop: isMobile ? "env(safe-area-inset-top)" : undefined,
            height: isMobile ? 56 : 64
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 12,
              minWidth: 0,
              flex: 1
            }}
          >
            {isMobile ? (
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label="打开导航"
                title="打开导航"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 8,
                  cursor: "pointer",
                  color: token.colorTextSecondary,
                  fontSize: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  minWidth: 40,
                  minHeight: 40
                }}
              >
                <MenuUnfoldOutlined />
              </button>
            ) : (
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
            )}
            {!isPhone && (
              <span
                aria-hidden="true"
                style={{
                  width: 1,
                  height: 20,
                  background: token.colorSplit,
                  flexShrink: 0
                }}
              />
            )}
            <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <Crumbs pathname={pathname} compact={isPhone} />
            </div>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 4 : 16, flexShrink: 0 }}>
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
                  justifyContent: "center",
                  minWidth: 40,
                  minHeight: 40,
                  borderRadius: 6
                }}
              >
                <BellOutlined />
              </button>
            </Badge>

            <Dropdown menu={{ items: userMenu }} trigger={["click"]} placement="bottomRight">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: isPhone ? 0 : 8,
                  cursor: "pointer",
                  padding: "4px 6px",
                  borderRadius: 6,
                  transition: "background-color 160ms"
                }}
              >
                <Avatar size={isMobile ? 28 : 28} icon={<UserOutlined />} style={{ background: token.colorPrimary }}>
                  {user.name?.[0]}
                </Avatar>
                {!isPhone && (
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                    <Text style={{ fontSize: 13 }}>{user.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {ROLE_LABEL[user.roleCode] ?? user.roleCode}
                    </Text>
                  </span>
                )}
                {!isMobile && <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />}
              </span>
            </Dropdown>
          </div>
        </Header>

        <Content
          key={pathname}
          className="app-anim-in"
          style={{
            padding: 0,
            minHeight: isMobile ? "calc(100vh - 56px)" : "calc(100vh - 64px)"
          }}
        >
          {children}
        </Content>
      </Layout>

      <Drawer
        title="消息中心"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        // 移动端:从底部弹出,占满宽度,符合拇指可达
        placement={isMobile ? "bottom" : "right"}
        styles={{
          wrapper: isMobile
            ? { height: "85%", width: "100%" }
            : { width: 420 },
          body: { padding: isMobile ? "0 12px 12px" : undefined }
        }}
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
          <div>
            {messages.map((m) => (
              <div
                key={m.id}
                role={m.link ? "button" : undefined}
                tabIndex={m.link ? 0 : undefined}
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
                onKeyDown={
                  m.link
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          (e.currentTarget as HTMLDivElement).click();
                        }
                      }
                    : undefined
                }
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
                  <span style={{ marginRight: 8 }}>{m.type}</span>
                  <span>{new Date(m.createdAt).toLocaleString("zh-CN")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </Layout>
  );
}

// URL 与菜单层级不一致的路由 — 按菜单结构定义面包屑,绕开按路径段拆分
const BREADCRUMB_OVERRIDE: Record<string, string[]> = {
  // /workflow/follow-ups 在菜单上属于 统计分析 父菜单,不再是 我的工作流 子项
  "/workflow/follow-ups": ["统计分析", "跟进 360"]
};

const CRUMB_LABEL: Record<string, string> = {
  dashboard: "工作台",
  customers: "客户管理",
  contracts: "合同管理",
  projects: "项目管理",
  workflow: "我的工作流",
  "workflow/board": "工作流看板",
  "statistics/workflow": "工作流概览",
  "admin/workflow-templates": "工作流模板",
  "admin/trash": "回收站",
  invoices: "开票管理",
  payments: "回款管理",
  statistics: "统计分析",
  overview: "总览",
  aging: "账龄分析",
  performance: "业务员业绩",
  messages: "消息中心",
  announcements: "公告",
  admin: "系统管理",
  users: "员工管理",
  roles: "角色权限",
  departments: "部门管理",
  dictionaries: "数据字典",
  "operation-logs": "操作日志",
  new: "新建",
  edit: "编辑"
};

function Crumbs({ pathname, compact }: { pathname: string; compact?: boolean }) {
  const override = BREADCRUMB_OVERRIDE[pathname];
  const parts = override ?? pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return <Text type="secondary">工作台</Text>;
  }
  // 极窄屏(<576)只显示最后一段,避免"工作台 / 客户管理 / 张三"挤爆 header
  if (compact) {
    const last = parts[parts.length - 1]!;
    return <Text>{CRUMB_LABEL[last] ?? last}</Text>;
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
