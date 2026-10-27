"use client";

import {
  ProTable,
  type ActionType,
  type ProColumns
} from "@ant-design/pro-components";
import {
  Tag,
  Button,
  Space,
  App as AntdApp,
  Tabs,
  Empty,
  Typography
} from "antd";
import { CheckOutlined, LinkOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRef, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { DateTimeCell } from "@/components/table-cells";
import { AnnouncementTab } from "@/components/notifications/announcement-tab";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { useUnreadCount, refreshUnread } from "@/lib/message-unread";
import { useMessageStream } from "@/lib/use-message-stream";
import { buildMessageLinkHref as buildLinkHref } from "@/lib/message-link";
import type { MessageRowPayload } from "@/lib/message-types";

const { Text } = Typography;

type TabKey = "all" | "unread" | "read" | "announcements";

type ListResp = {
  list: MessageRowPayload[];
  total?: number;
};

export default function MessagesPage() {
  const t = useT();
  const { message: msg } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const actionRef = useRef<ActionType>(undefined);
  const searchParams = useSearchParams();
  const initialTab: TabKey = searchParams.get("tab") === "announcements" ? "announcements" : "all";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [data, setData] = useState<MessageRowPayload[]>([]);
  const unreadCount = useUnreadCount();

  useMessageStream({
    onKick: () => {
      actionRef.current?.reload?.();
      refreshUnread();
    },
    onNewMessage: (row) => {
      setData((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        if (tab === "read" && !row.readAt) return prev;
        return [row, ...prev];
      });
      refreshUnread();
    }
  });

  const columns: ProColumns<MessageRowPayload>[] = useMemo(
    () => [
      {
        title: t("messages.column.type"),
        dataIndex: "type",
        width: 130,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
      },
      {
        title: t("messages.column.message"),
        dataIndex: "title",
        width: 400,
        render: (_, r) => (
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {!r.readAt ? (
                <span
                  aria-label="未读"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--ant-color-primary, #1677ff)",
                    flexShrink: 0
                  }}
                />
              ) : null}
              <Text
                strong={!r.readAt}
                style={{
                  color: r.readAt ? "var(--qt-text-muted)" : undefined,
                  display: "block",
                  whiteSpace: "normal"
                }}
              >
                {r.title}
              </Text>
            </div>
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
        width: 170,
        render: (_, r) => <DateTimeCell value={r.createdAt} />
      },
      {
        title: t("messages.column.actions"),
        width: 180,
        fixed: "right",
        render: (_, r) => {
          const href = buildLinkHref(r.link);
          return (
            <Space size={4} wrap>
              {href ? (
                <Link href={href}>
                  <Button type="link" size="small" icon={<LinkOutlined />}>
                    {t("messages.action.view")}
                  </Button>
                </Link>
              ) : null}
              {!r.readAt ? (
                <Button
                  type="link"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={async () => {
                    const res = await fetch(`/api/messages/${r.id}`, {
                      method: "PATCH",
                      credentials: "include"
                    });
                    const j = await res.json();
                    if (j.code === 0) {
                      msg.success(t("messages.tag.read"));
                      actionRef.current?.reload?.();
                    }
                  }}
                >
                  {t("messages.action.markRead")}
                </Button>
              ) : null}
            </Space>
          );
        }
      }
    ],
    [t, msg]
  );

  const tabs: { key: TabKey; label: React.ReactNode }[] = useMemo(
    () => [
      { key: "all", label: t("messages.tab.all") },
      {
        key: "unread",
        label: (
          <Space size={4}>
            <span>{t("messages.tab.unread")}</span>
            {unreadCount > 0 ? (
              <Tag color="red" style={{ margin: 0 }}>
                {unreadCount}
              </Tag>
            ) : null}
          </Space>
        )
      },
      { key: "read", label: t("messages.tab.read") },
      { key: "announcements", label: t("messages.tab.announcements") }
    ],
    [t, unreadCount]
  );

  const markAllRead = useCallback(async () => {
    try {
      const r = await fetch("/api/messages/mark-all-read", {
        method: "POST",
        credentials: "include"
      });
      const j = await r.json();
      if (j.code === 0) {
        msg.success(t("messages.toast.markedRead", { n: j.data.updated }));
        actionRef.current?.reload?.();
        refreshUnread();
      } else {
        msg.error(j.message);
      }
    } catch {
      msg.error(t("messages.toast.actionFailed"));
    }
  }, [msg, t]);

  return (
    <Page>
      <PageHeader
        title={t("messages.title")}
        subtitle={t("messages.subtitle")}
        actions={
          tab === "announcements" ? undefined : (
            <Button
              icon={<CheckOutlined />}
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              {t("messages.markAllRead")}
            </Button>
          )
        }
      />

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            marginBottom: 8,
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
            items={tabs}
            size={isMobile ? "small" : "middle"}
            tabBarStyle={{ marginBottom: 0 }}
          />
        </div>
        {tab === "announcements" ? (
          <AnnouncementTab />
        ) : (
          <ProTable<MessageRowPayload>
            key={tab}
            actionRef={actionRef}
            rowKey="id"
            search={false}
            dataSource={data}
            onDataSourceChange={setData}
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
                    tab === "unread"
                      ? t("messages.empty.unread")
                      : tab === "read"
                        ? t("messages.empty.read")
                        : t("messages.empty")
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
              const data = j.data as ListResp;
              return {
                data: data.list,
                total: data.total ?? data.list.length,
                success: true
              };
            }}
            options={false}
            columns={columns}
          />
        )}
      </div>
    </Page>
  );
}
