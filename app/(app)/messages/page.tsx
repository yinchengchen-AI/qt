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
  const { message: msg } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);

  return (
    <Page>
      <PageHeader
        title="消息中心"
        subtitle="业务事件通知(待审批 / 合同到期 / 项目到期 / 回款 / 客户静默 等)"
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
            全部标记已读
          </Button>
        }
      />
      <ProTable<Message> actionRef={actionRef}
        rowKey="id"
        search={false}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        cardBordered={false}
        request={makeListRequest<Message>("/api/messages")}
        columns={[
          {
            title: "状态",
            dataIndex: "readAt",
            width: 80,
            render: (_, r) => (r.readAt ? <Tag>已读</Tag> : <Tag color="red">未读</Tag>)
          },
          {
            title: "类型",
            dataIndex: "type",
            width: 110,
            render: (_, r) => <StatusTag status={r.type} domain="message" />
          },
          { title: "标题", dataIndex: "title", width: 320 },
          { title: "内容", dataIndex: "content", ellipsis: true },
          {
            title: "时间",
            dataIndex: "createdAt",
            width: 180,
            render: (_, r) => <DateTimeCell value={r.createdAt} />
          },
          {
            title: "操作",
            width: 220,
            render: (_, r) => (
              <Space>
                {(() => {
                  const href = buildLinkHref(r.link);
                  if (!href) return null;
                  return (
                    <Link href={href}>
                      <Button type="link" size="small">查看</Button>
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
                    标记已读
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={async () => {
                    const res = await fetch(`/api/messages/${r.id}`, { method: "DELETE", credentials: "include" });
                    const j = await res.json();
                    if (j.code === 0) actionRef.current?.reloadAndRest?.();
                  }}
                >
                  删除
                </Button>
              </Space>
            )
          }
        ]}
      />
    </Page>
  );
}
