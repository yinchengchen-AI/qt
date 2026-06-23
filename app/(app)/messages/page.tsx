"use client";
import { ProTable, type ActionType } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp } from "antd";
import Link from "next/link";
import { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { makeListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";
import { useT } from "@/lib/i18n";

type Message = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
};

// 跳转路径与防御性 URL 拼装抽到 lib/message-link.ts, 与 dashboard-shell 复用.
import { buildMessageLinkHref as buildLinkHref } from "@/lib/message-link";

export default function MessagesPage() {
  const t = useT();
  const { message: msg, modal } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);

  return (
    <Page>
      <PageHeader
        title={t("messages.title")}
        subtitle={t("messages.subtitle")}
        actions={
          <Button
            key="all"
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
        }
      />
      <ProTable<Message>
        actionRef={actionRef}
        rowKey="id"
        search={false}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        cardBordered={false}
        request={makeListRequest<Message>("/api/messages")}
        columns={[
          {
            title: t("messages.column.status"),
            dataIndex: "readAt",
            width: 80,
            render: (_, r) => (r.readAt ? <Tag>{t("messages.tag.read")}</Tag> : <Tag color="red">{t("messages.tag.unread")}</Tag>)
          },
          {
            title: t("messages.column.type"),
            dataIndex: "type",
            width: 110,
            render: (_, r) => <StatusTag status={r.type} domain="message" />
          },
          { title: t("messages.column.title"), dataIndex: "title", width: 320 },
          { title: t("messages.column.content"), dataIndex: "content", ellipsis: true },
          {
            title: t("messages.column.time"),
            dataIndex: "createdAt",
            width: 180,
            render: (_, r) => <DateTimeCell value={r.createdAt} />
          },
          {
            title: t("messages.column.actions"),
            width: 220,
            render: (_, r) => (
              <Space>
                {(() => {
                  const href = buildLinkHref(r.link);
                  if (!href) return null;
                  return (
                    <Link href={href}>
                      <Button type="link" size="small">{t("messages.action.view")}</Button>
                    </Link>
                  );
                })()}
                {!r.readAt && (
                  <Button
                    type="link"
                    size="small"
                    onClick={async () => {
                      const res = await fetch(`/api/messages/${r.id}`, { method: "PATCH", credentials: "include" });
                      const j = await res.json();
                      if (j.code === 0) actionRef.current?.reloadAndRest?.();
                    }}
                  >
                    {t("messages.action.markRead")}
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  danger
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
        ]}
      />
    </Page>
  );
}
