"use client";
import { ProTable } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp } from "antd";
import { useSWRConfig } from "swr";
import Link from "next/link";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { EmptyState } from "@/components/empty-state";
import { formatStatus, type StatusDomain } from "@/lib/status";
import { useState } from "react";

type Message = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
};

const DOMAIN: StatusDomain = "message";

const LINK_PATH: Record<string, string> = {
  contract: "/contracts",
  invoice: "/invoices",
  payment: "/payments",
  project: "/projects",
  customer: "/customers"
};

export default function MessagesPage() {
  const { message: msg } = AntdApp.useApp();
  const { mutate } = useSWRConfig();
  const [error, setError] = useState<string | null>(null);
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
                mutate((k) => typeof k === "string" && k.startsWith("/api/messages"));
              } else msg.error(j.message);
            }}
          >
            全部标记已读
          </Button>
        }
      />
      {error ? (
        <EmptyState
          error={{ message: error, onRetry: () => setError(null) }}
          title="加载失败"
        />
      ) : (
        <ProTable<Message>
          rowKey="id"
          search={false}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          cardBordered={false}
          request={async (params) => {
            try {
              const qs = new URLSearchParams({ page: String(params.current ?? 1), pageSize: String(params.pageSize ?? 20) });
              const r = await fetch(`/api/messages?${qs}`, { credentials: "include" });
              const j = await r.json();
              if (j.code !== 0) throw new Error(j.message);
              return { data: j.data.list, total: j.data.total, success: true };
            } catch (e) {
              setError((e as Error).message);
              return { data: [], total: 0, success: false };
            }
          }}
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
              render: (_, r) => <StatusTag status={r.type} domain={DOMAIN} />
            },
            { title: "标题", dataIndex: "title", width: 320 },
            { title: "内容", dataIndex: "content", ellipsis: true },
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 180,
              render: (v) => new Date(v as string).toLocaleString("zh-CN")
            },
            {
              title: "操作",
              width: 220,
              render: (_, r) => (
                <Space>
                  {r.link && (
                    <Link href={`${LINK_PATH[r.link.kind] ?? "/"}/${r.link.id}`}>
                      <Button type="link" size="small">查看</Button>
                    </Link>
                  )}
                  {!r.readAt && (
                    <Button
                      type="link"
                      size="small"
                      onClick={async () => {
                        const res = await fetch(`/api/messages/${r.id}`, { method: "PATCH", credentials: "include" });
                        const j = await res.json();
                        if (j.code === 0) mutate((k) => typeof k === "string" && k.startsWith("/api/messages"));
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
                      if (j.code === 0) mutate((k) => typeof k === "string" && k.startsWith("/api/messages"));
                    }}
                  >
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
        />
      )}
    </Page>
  );
}
