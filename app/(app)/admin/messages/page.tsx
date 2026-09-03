"use client";
// 消息归档 v2 (2026-09-03)
// 后端 service listArchivedMessages 已显式校验 roleCode === "ADMIN"
// UI 列表 + 月份/类型/关键词 过滤 + 接收人 ID 过滤
import { useRef, useState } from "react";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { Empty, Tag, Typography, Card, Input, Space, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { DateTimeCell } from "@/components/table-cells";
import { buildMessageLinkHref } from "@/lib/message-link";
import { MESSAGE_TYPE } from "@/types/enums";

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
  const [q, setQ] = useState<string>("");
  const [types, setTypes] = useState<string[]>([]);

  const columns: ProColumns<Archive>[] = [
    {
      title: t("admin.messagesArchive.column.type"),
      dataIndex: "type",
      width: 140,
      render: (_, r) => <Tag>{r.type}</Tag>
    },
    {
      title: t("admin.messagesArchive.column.title"),
      dataIndex: "title",
      width: 240,
      ellipsis: true,
      render: (_, r) => <Text strong>{r.title}</Text>
    },
    {
      title: t("admin.messagesArchive.column.content"),
      dataIndex: "content",
      hideInTable: isMobile,
      ellipsis: true,
      render: (_, r) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{r.content}</Text>
      )
    },
    {
      title: t("admin.messagesArchive.column.receiver"),
      dataIndex: "receiverUserId",
      width: 180,
      render: (_, r) => <Text code style={{ fontSize: 11 }}>{r.receiverUserId}</Text>
    },
    {
      title: t("admin.messagesArchive.column.link"),
      dataIndex: "link",
      width: 80,
      render: (_, r) => {
        const href = buildMessageLinkHref(r.link);
        return href ? <a href={href} target="_blank" rel="noreferrer">{t("admin.messagesArchive.action.view")}</a> : "—";
      }
    },
    {
      title: t("admin.messagesArchive.column.createdAt"),
      dataIndex: "createdAt",
      width: 160,
      render: (_, r) => <DateTimeCell value={r.createdAt} />
    },
    {
      title: t("admin.messagesArchive.column.archivedAt"),
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
      />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <span>{t("admin.messagesArchive.filter.month")}</span>
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
          <span>{t("admin.messagesArchive.filter.types")}</span>
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 200 }}
            placeholder={t("admin.messagesArchive.filter.typesPlaceholder")}
            value={types}
            onChange={setTypes}
            options={MESSAGE_TYPE.map((tp) => ({ value: tp, label: tp }))}
            maxTagCount={isMobile ? 1 : 3}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("admin.messagesArchive.filter.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 240 }}
          />
        </Space>
      </Card>
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
          if (types.length > 0) qs.set("types", types.join(","));
          if (q.trim()) qs.set("q", q.trim());
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
