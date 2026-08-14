"use client";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp, Tabs, Empty, Typography, Card, Skeleton } from "antd";
import { CheckOutlined, DeleteOutlined, LinkOutlined, PushpinOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { DateTimeCell } from "@/components/table-cells";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { useUnreadCount, refreshUnread } from "@/lib/message-unread";
import { useMessageStream } from "@/lib/use-message-stream";
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

  const unreadCount = useUnreadCount();

  useMessageStream({ onKick: () => {
    actionRef.current?.reload?.();
    refreshUnread();
  } });

  type PinnedAnnouncement = { id: string; title: string; content: string; publishAt: string };
  const [pinned, setPinned] = useState<PinnedAnnouncement[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/announcements/pinned", { credentials: "include" });
        const j = await r.json();
        if (j.code === 0) setPinned(j.data?.list ?? []);
      } catch { /* empty */ }
      setPinnedLoading(false);
    })();
  }, []);

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
      title: t("messages.column.message"),
      dataIndex: "title",
      width: 360,
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <Text
            strong={!r.readAt}
            style={{
              color: r.readAt ? "var(--qt-text-muted)" : undefined,
              display: "block"
            }}
          >
            {r.title}
          </Text>
          {r.content ? (
            <Text
              type="secondary"
              style={{
                fontSize: 12,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                marginTop: 2
              }}
            >
              {r.content}
            </Text>
          ) : null}
        </div>
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
                  actionRef.current?.reload?.();
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
                  if (j.code === 0) actionRef.current?.reload?.();
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
    { key: "all", label: t("messages.tab.all") },
    {
      key: "unread",
      label: (
        <Space size={6}>
          <span>{t("messages.tab.unread")}</span>
          {unreadCount > 0 ? <Tag color="red" style={{ margin: 0 }}>{unreadCount}</Tag> : null}
        </Space>
      )
    },
    { key: "read", label: t("messages.tab.read") }
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
                  msg.success(t("messages.toast.markedRead", { n: j.data.updated }));
                  actionRef.current?.reload?.();
                  refreshUnread();
                } else msg.error(j.message);
              }}
            >
              {t("messages.markAllRead")}
            </Button>
            <Button
              key="clear"
              icon={<DeleteOutlined />}
              danger
              onClick={() => {
                modal.confirm({
                  title: t("messages.clearReadConfirm.title"),
                  content: t("messages.clearReadConfirm.content"),
                  okText: t("messages.action.clearRead"),
                  okType: "danger",
                  cancelText: t("announcements.cancel"),
                  onOk: async () => {
                    const r = await fetch("/api/messages/read/clear", { method: "POST", credentials: "include" });
                    const j = await r.json();
                    if (j.code === 0) {
                      msg.success(t("messages.toast.clearedRead", { n: j.data.deleted }));
                      actionRef.current?.reload?.();
                    } else msg.error(j.message);
                  }
                });
              }}
            >
              {t("messages.action.clearRead")}
            </Button>
          </Space>
        }
      />

      {pinnedLoading ? (
        <Card size="small" style={{ marginBottom: 12 }}><Skeleton active paragraph={{ rows: 1 }} /></Card>
      ) : pinned.length > 0 ? (
        <Card
          size="small"
          title={<Space size={6}><PushpinOutlined />{t("messages.pinned.title")}</Space>}
          style={{ marginBottom: 12 }}
        >
          {pinned.map((p) => (
            <div key={p.id} style={{ marginBottom: 8 }}>
              <Text strong>{p.title}</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>{p.content}</Paragraph>
            </div>
          ))}
        </Card>
      ) : null}

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
            actionRef.current?.reload?.();
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
          showSizeChanger: !isMobile,
          size: isMobile ? "small" : undefined
        }}
        cardBordered={false}
        scroll={{ x: "max-content" }}
        sticky={isMobile}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                tab === "unread" ? t("messages.empty.unread") : tab === "read" ? t("messages.empty.read") : t("messages.empty")
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
