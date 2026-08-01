"use client";
// 消息归档(只读) — ADMIN only
// 后端 service listArchivedMessages 已显式校验 roleCode === "ADMIN"
// 这里只负责 UI 列表 + 月份过滤
import { useRef, useState } from "react";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { Empty, Tag, Typography } from "antd";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { DateTimeCell } from "@/components/table-cells";
import { buildMessageLinkHref } from "@/lib/message-link";

const { Text } = Typography;

type Archive = {
  id: string;
  receiverUserId: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
  archivedAt: string;
};

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AdminMessagesArchivePage() {
  const t = useT();
  const { isMobile } = useResponsive();
  const actionRef = useRef<ActionType>(undefined);
  const [month, setMonth] = useState<string>(currentMonthYYYYMM());

  const columns: ProColumns<Archive>[] = [
    {
      title: "类型",
      dataIndex: "type",
      width: 120,
      render: (_, r) => <Tag>{r.type}</Tag>
    },
    {
      title: "标题",
      dataIndex: "title",
      width: 240,
      ellipsis: true,
      render: (_, r) => <Text strong>{r.title}</Text>
    },
    {
      title: "内容",
      dataIndex: "content",
      hideInTable: isMobile,
      ellipsis: true,
      render: (_, r) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{r.content}</Text>
      )
    },
    {
      title: "接收人",
      dataIndex: "receiverUserId",
      width: 180,
      render: (_, r) => <Text code style={{ fontSize: 11 }}>{r.receiverUserId}</Text>
    },
    {
      title: "链接",
      dataIndex: "link",
      width: 80,
      render: (_, r) => {
        const href = buildMessageLinkHref(r.link);
        return href ? <a href={href} target="_blank" rel="noreferrer">查看</a> : "—";
      }
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 160,
      render: (_, r) => <DateTimeCell value={r.createdAt} />
    },
    {
      title: "归档时间",
      dataIndex: "archivedAt",
      width: 160,
      render: (_, r) => <DateTimeCell value={r.archivedAt} />
    }
  ];

  return (
    <Page>
      <PageHeader
        title={t("admin.messagesArchive.title")}
        subtitle={t("admin.messagesArchive.subtitle")}
        actions={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              height: 32,
              padding: "0 8px",
              border: "1px solid var(--qt-border)",
              borderRadius: 6
            }}
            aria-label="归档月份"
          />
        }
      />
      <ProTable<Archive>
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
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={month ? `${month} 无归档消息` : "无归档消息"}
            />
          )
        }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          qs.set("month", month);
          const r = await fetch(`/api/admin/messages-archive?${qs}`, { credentials: "include" });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile }}
        columns={columns}
      />
    </Page>
  );
}
