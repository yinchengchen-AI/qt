"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp } from "antd";
import { useSWRConfig } from "swr";
import Link from "next/link";

type Message = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, { text: string; color: string }> = {
  CONTRACT_PENDING_REVIEW: { text: "待审批", color: "blue" },
  CONTRACT_EXPIRING: { text: "合同到期", color: "orange" },
  CONTRACT_APPROVED: { text: "已通过", color: "green" },
  CONTRACT_REJECTED: { text: "已驳回", color: "red" },
  INVOICE_OVERDUE_PAYMENT: { text: "开票超期", color: "red" },
  PAYMENT_RECEIVED: { text: "回款", color: "green" },
  PROJECT_DUE: { text: "项目到期", color: "orange" },
  CUSTOMER_INACTIVE: { text: "客户静默", color: "default" }
};

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
  return (
    <ProCard>
      <ProTable<Message>
        rowKey="id"
        headerTitle="消息中心"
        search={false}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        toolBarRender={() => [
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
        ]}
        request={async (params) => {
          const qs = new URLSearchParams({ page: String(params.current ?? 1), pageSize: String(params.pageSize ?? 20) });
          const r = await fetch(`/api/messages?${qs}`, { credentials: "include" });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
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
            width: 100,
            render: (_, r) => <Tag color={TYPE_LABEL[r.type]?.color}>{TYPE_LABEL[r.type]?.text ?? r.type}</Tag>
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
            width: 200,
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
    </ProCard>
  );
}
