"use client";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp, Tabs, Empty, Typography, Popover } from "antd";
import { CheckOutlined, DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRef, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { DateTimeCell } from "@/components/table-cells";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import useSWR from "swr";
import { buildMessageLinkHref as buildLinkHref } from "@/lib/message-link";

const { Text, Paragraph } = Typography;

type Message = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
};

type TabKey = "all" | "unread" | "read";

export default function MessagesPage() {
  const t = useT();
  const { message: msg, modal } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const actionRef = useRef<ActionType>(undefined);
  const [tab, setTab] = useState<TabKey>("all");

  // 未读数量 (用于 tab 角标)
  const { data: unreadResp } = useSWR<{ unreadCount: number }>(
    "/api/messages/unread-count",
    async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json();
      return j.data ?? { unreadCount: 0 };
    }
  );
  const unreadCount = unreadResp?.unreadCount ?? 0;

  const columns: ProColumns<Message>[] = [
    {
      title: t("messages.column.status"),
      dataIndex: "readAt",
      width: 90,
      render: (_, r) =>
        r.readAt ? (
          <Tag icon={<CheckOutlined />} color="default" style={{ margin: 0 }}>{t("messages.tag.read")}</Tag>
        ) : (
          <Tag color="red" style={{ margin: 0 }}>{t("messages.tag.unread")}</Tag>
        )
    },
    {
      title: t("messages.column.type"),
      dataIndex: "type",
      width: 120,
      render: (_, r) => <StatusTag status={r.type} domain="message" />
    },
    {
      title: t("messages.column.title"),
      dataIndex: "title",
      width: 320,
      render: (_, r) => (
        <Space size={6} align="start" wrap>
          <Text
            strong={!r.readAt}
            style={{
              color: r.readAt ? "var(--qt-text-muted)" : undefined
            }}
          >
            {r.title}
          </Text>
          {r.content && r.content.length > 60 ? (
            <Popover
              content={
                <div style={{ maxWidth: 360 }}>
                  <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                    {r.content}
                  </Paragraph>
                </div>
              }
              trigger="hover"
              placement="topLeft"
            >
              <Text type="secondary" style={{ fontSize: 12, cursor: "help" }}>
                详情
              </Text>
            </Popover>
          ) : null}
        </Space>
      )
    },
    {
      title: t("messages.column.content"),
      dataIndex: "content",
      ellipsis: true,
      render: (_, r) => (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {r.content}
        </Text>
      )
    },
    {
      title: t("messages.column.time"),
      dataIndex: "createdAt",
      width: 180,
      render: (_, r) => <DateTimeCell value={r.createdAt} />
    },
    {
      title: t("messages.column.actions"),
      width: 240,
      fixed: "right",
      render: (_, r) => (
        <Space size={4} wrap>
          {(() => {
            const href = buildLinkHref(r.link);
            if (!href) return null;
            return (
              <Link href={href}>
                <Button type="link" size="small" icon={<LinkOutlined />}>
                  {t("messages.action.view")}
                </Button>
              </Link>
            );
          })()}
          {!r.readAt && (
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              onClick={async () => {
                const res = await fetch(`/api/messages/${r.id}`, { method: "PATCH", credentials: "include" });
                const j = await res.json();
                if (j.code === 0) {
                  msg.success(t("messages.tag.read"));
                  actionRef.current?.reloadAndRest?.();
                }
              }}
            >
              {t("messages.action.markRead")}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              modal.confirm({
                title: t("messages.deleteConfirm.title"),
                content: t("messages.deleteConfirm.content"),
                okText: t("messages.action.delete"),
                okType: "danger",
                cancelText: t("announcements.cancel"),
                onOk: async () => {
                  const res = await fetch(`/api/messages/${r.id}`, { method: "DELETE", credentials: "include" });
                  const j = await res.json();
                  if (j.code === 0) actionRef.current?.reloadAndRest?.();
                }
              });
            }}
          >
            {t("messages.action.delete")}
          </Button>
        </Space>
      )
    }
  ];

  const tabItems = [
    { key: "all", label: "全部" },
    {
      key: "unread",
      label: (
        <Space size={6}>
          <span>未读</span>
          {unreadCount > 0 ? <Tag color="red" style={{ margin: 0 }}>{unreadCount}</Tag> : null}
        </Space>
      )
    },
    { key: "read", label: "已读" }
  ];

  return (
    <Page>
      <PageHeader
        title={t("messages.title")}
        subtitle={t("messages.subtitle")}
        actions={
          <Space>
            <Button
              key="all"
              icon={<CheckOutlined />}
              disabled={unreadCount === 0}
              onClick={async () => {
                const r = await fetch("/api/messages/mark-all-read", { method: "POST", credentials: "include" });
                const j = await r.json();
                if (j.code === 0) {
                  msg.success(`已标记 ${j.data.updated} 条已读`);
                  actionRef.current?.reloadAndRest?.();
                } else msg.error(j.message);
              }}
            >
              {t("messages.markAllRead")}
            </Button>
          </Space>
        }
      />

      <div
        style={{
          marginBottom: 12,
          padding: "4px 8px",
          background: "var(--qt-bg)",
          border: "1px solid var(--qt-border-soft)",
          borderRadius: 8
        }}
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            setTab(k as TabKey);
            actionRef.current?.reloadAndRest?.();
          }}
          items={tabItems}
          size={isMobile ? "small" : "middle"}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>

      <ProTable<Message>
        key={tab}
        actionRef={actionRef}
        rowKey="id"
        search={false}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          size: isMobile ? "small" : undefined
        }}
        cardBordered={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                tab === "unread" ? "暂无未读消息" : tab === "read" ? "暂无已读消息" : t("messages.empty")
              }
            />
          )
        }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (tab === "unread") qs.set("unread", "true");
          else if (tab === "read") qs.set("unread", "false");
          const r = await fetch(`/api/messages?${qs}`, { credentials: "include" });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile, fullScreen: !isMobile }}
        columns={columns}
      />
    </Page>
  );
}
