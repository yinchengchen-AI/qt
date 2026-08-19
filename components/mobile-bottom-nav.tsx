"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "antd";
import {
  AppstoreOutlined,
  BellOutlined,
  FileTextOutlined,
  UserOutlined
} from "@ant-design/icons";

const ITEMS = [
  { path: "/dashboard", name: "工作台", icon: <AppstoreOutlined /> },
  { path: "/contracts", name: "合同", icon: <FileTextOutlined /> },
  { path: "/messages", name: "消息", icon: <BellOutlined /> },
  // 「我的」= 个人合同工作台 (我的待办/我的合同), 与个人视角对齐
  { path: "/contracts/workbench", name: "我的", icon: <UserOutlined /> }
] as const;

/** 移动端底部固定导航 (Phase 5, spec §8.3); 仅手机断点渲染, 桌面/平板由侧边栏承担 */
export function MobileBottomNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname();
  const active = (p: string) =>
    p === "/contracts" ? pathname.startsWith("/contracts") && !pathname.startsWith("/contracts/workbench") : pathname.startsWith(p);
  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        display: "flex",
        background: "#fff",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        paddingBottom: "env(safe-area-inset-bottom)"
      }}
    >
      {ITEMS.map((item) => {
        const isActive = active(item.path);
        const color = isActive ? "#1677ff" : "rgba(0,0,0,0.55)";
        return (
          <Link
            key={item.path}
            href={item.path}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 0 4px",
              color,
              fontSize: 10,
              gap: 2
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>
              {item.path === "/messages" ? <Badge count={unreadMessages} size="small">{item.icon}</Badge> : item.icon}
            </span>
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
