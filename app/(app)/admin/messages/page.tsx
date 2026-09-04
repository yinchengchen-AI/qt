"use client";
// 消息归档管理 (v0.24.0 模式切换: 归档 / 回收站)
//
// 后端: GET /api/admin/messages-archive?mode=archive|recycle
//   - archive: MessageArchive (read+90d cron 写入)
//   - recycle: Message with deletedAt != null (用户软删, 30 天后由 cron hard delete)
//
// 操作: 移到收件箱 (archive) / 恢复 (recycle) / 彻底删除 (recycle, 跳过 30 天)
import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { Empty, Tag, Typography, Card, Input, Space, Select, Segmented, Button, Popconfirm, App as AntdApp } from "antd";
import { SearchOutlined, UndoOutlined, InboxOutlined, DeleteFilled } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { DateTimeCell } from "@/components/table-cells";
import { buildMessageLinkHref } from "@/lib/message-link";
import { MESSAGE_TYPE } from "@/types/enums";

const { Text } = Typography;

type Mode = "archive" | "recycle";

type ArchiveRow = {
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

type RecycleRow = {
  id: string;
  receiverUserId: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
  deletedAt: string;
};

type UserMini = { id: string; employeeNo: string; name: string };

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AdminMessagesArchivePage() {
  const t = useT();
  const { isMobile } = useResponsive();
  const { message: msg } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const [mode, setMode] = useState<Mode>("archive");
  const [month, setMonth] = useState<string>(currentMonthYYYYMM());
  const [q, setQ] = useState<string>("");
  const [types, setTypes] = useState<string[]>([]);
  const [receiverUserId, setReceiverUserId] = useState<string | undefined>(undefined);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [busy, setBusy] = useState(false);

  // 加载用户列表 (下拉)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/messages-archive/users", { credentials: "include" });
        const j = await r.json();
        if (j.code === 0) setUsers(j.data.list as UserMini[]);
      } catch {
        /* empty */
      }
    })();
  }, []);

  const reset = () => {
    setSelectedRowKeys([]);
    actionRef.current?.reload?.();
  };

  // 移到收件箱 (archive 单条)
  const moveToInbox = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const r = await fetch(`/api/admin/messages-archive/${id}/restore`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "archive" })
        });
        const j = await r.json();
        if (j.code === 0) {
          msg.success(t("messages.toast.movedToInbox", { n: 1 }));
          reset();
        } else msg.error(j.message);
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      } finally {
        setBusy(false);
      }
    },
    [msg, t]
  );

  // recycle 操作: restore (软删还原) / purge (hard delete)
  const recycleOp = useCallback(
    async (ids: React.Key[], action: "restore" | "purge") => {
      if (ids.length === 0) return;
      setBusy(true);
      try {
        const r = await fetch("/api/admin/messages-archive/batch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, mode: "recycle", action })
        });
        const j = await r.json();
        if (j.code === 0) {
          msg.success(action === "restore"
            ? t("messages.toast.restored", { n: j.data.affected })
            : t("messages.toast.purged", { n: j.data.affected })
          );
          reset();
        } else msg.error(j.message);
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      } finally {
        setBusy(false);
      }
    },
    [msg, t]
  );

  // archive columns
  const archiveColumns: ProColumns<ArchiveRow>[] = useMemo(
    () => [
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
        title: t("admin.messagesArchive.column.receiverName"),
        dataIndex: "receiverUserId",
        width: 140,
        render: (_, r) => {
          const u = users.find((x) => x.id === r.receiverUserId);
          if (u) return <Text style={{ fontSize: 12 }}>{u.name} ({u.employeeNo})</Text>;
          return <Text code style={{ fontSize: 11 }}>{r.receiverUserId}</Text>;
        }
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
      },
      {
        title: t("messages.column.actions"),
        key: "actions",
        width: 140,
        render: (_, r) => (
          <Popconfirm
            title={t("admin.messagesArchive.confirm.moveToInbox")}
            okText={t("messages.action.moveToInbox")}
            cancelText={t("announcements.cancel")}
            onConfirm={() => moveToInbox(r.id)}
          >
            <Button type="link" size="small" icon={<InboxOutlined />} disabled={busy}>
              {t("messages.action.moveToInbox")}
            </Button>
          </Popconfirm>
        )
      }
    ],
    [t, isMobile, users, busy, moveToInbox]
  );

  // recycle columns
  const recycleColumns: ProColumns<RecycleRow>[] = useMemo(
    () => [
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
        title: t("admin.messagesArchive.column.receiverName"),
        dataIndex: "receiverUserId",
        width: 140,
        render: (_, r) => {
          const u = users.find((x) => x.id === r.receiverUserId);
          if (u) return <Text style={{ fontSize: 12 }}>{u.name} ({u.employeeNo})</Text>;
          return <Text code style={{ fontSize: 11 }}>{r.receiverUserId}</Text>;
        }
      },
      {
        title: t("admin.messagesArchive.column.deletedAt"),
        dataIndex: "deletedAt",
        width: 160,
        render: (_, r) => <DateTimeCell value={r.deletedAt} />
      },
      {
        title: t("messages.column.actions"),
        key: "actions",
        width: 200,
        render: (_, r) => (
          <Space size={4}>
            <Popconfirm
              title={t("messages.recycle.restoreConfirm.title")}
              description={t("messages.recycle.restoreConfirm.content")}
              okText={t("messages.action.restore")}
              cancelText={t("announcements.cancel")}
              onConfirm={() => recycleOp([r.id], "restore")}
            >
              <Button type="link" size="small" icon={<UndoOutlined />} disabled={busy}>
                {t("messages.action.restore")}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t("admin.messagesArchive.confirm.purge")}
              okText={t("messages.action.purge")}
              okType="danger"
              cancelText={t("announcements.cancel")}
              onConfirm={() => recycleOp([r.id], "purge")}
            >
              <Button type="link" size="small" danger icon={<DeleteFilled />} disabled={busy}>
                {t("messages.action.purge")}
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    ],
    [t, isMobile, users, busy, recycleOp]
  );

  return (
    <Page>
      <PageHeader
        title={t("admin.messagesArchive.title")}
        subtitle={t("admin.messagesArchive.subtitle")}
      />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(v) => {
              setMode(v as Mode);
              setSelectedRowKeys([]);
            }}
            options={[
              { value: "archive", label: t("admin.messagesArchive.mode.archive") },
              { value: "recycle", label: t("admin.messagesArchive.mode.recycle") }
            ]}
          />
          {mode === "archive" ? (
            <span>{t("admin.messagesArchive.filter.month")}</span>
          ) : null}
          {mode === "archive" ? (
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
          ) : null}
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
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 180 }}
            placeholder="接收人"
            value={receiverUserId}
            onChange={(v) => setReceiverUserId(v ?? undefined)}
            options={users.map((u) => ({
              value: u.id,
              label: `${u.name} (${u.employeeNo})`
            }))}
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

      {mode === "recycle" && selectedRowKeys.length > 0 ? (
        <Card size="small" style={{ marginBottom: 8 }}>
          <Space wrap>
            <Text strong>{t("messages.batch.selected", { n: selectedRowKeys.length })}</Text>
            <Button
              type="primary"
              size="small"
              icon={<UndoOutlined />}
              disabled={busy}
              onClick={() => recycleOp(selectedRowKeys, "restore")}
            >
              {t("admin.messagesArchive.batch.restore")}
            </Button>
            <Popconfirm
              title={t("admin.messagesArchive.confirm.purge")}
              okText={t("messages.action.purge")}
              okType="danger"
              cancelText={t("announcements.cancel")}
              onConfirm={() => recycleOp(selectedRowKeys, "purge")}
            >
              <Button danger size="small" icon={<DeleteFilled />} disabled={busy}>
                {t("admin.messagesArchive.batch.purge")}
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              {t("messages.batch.clear")}
            </Button>
          </Space>
        </Card>
      ) : null}

      {mode === "archive" ? (
        <ProTable<ArchiveRow>
          key="archive"
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
            qs.set("mode", "archive");
            qs.set("month", month);
            if (receiverUserId) qs.set("receiverUserId", receiverUserId);
            if (types.length > 0) qs.set("types", types.join(","));
            if (q.trim()) qs.set("q", q.trim());
            const r = await fetch(`/api/admin/messages-archive?${qs}`, { credentials: "include" });
            const j = await r.json();
            if (j.code !== 0) throw new Error(j.message);
            return { data: j.data.list as ArchiveRow[], total: j.data.total, success: true };
          }}
          options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile }}
          columns={archiveColumns}
        />
      ) : (
        <ProTable<RecycleRow>
          key="recycle"
          actionRef={actionRef}
          rowKey="id"
          search={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
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
                description={t("admin.messagesArchive.empty.recycle")}
              />
            )
          }}
          request={async (params) => {
            const qs = new URLSearchParams();
            qs.set("page", String(params.current ?? 1));
            qs.set("pageSize", String(params.pageSize ?? 20));
            qs.set("mode", "recycle");
            if (receiverUserId) qs.set("receiverUserId", receiverUserId);
            if (types.length > 0) qs.set("types", types.join(","));
            if (q.trim()) qs.set("q", q.trim());
            const r = await fetch(`/api/admin/messages-archive?${qs}`, { credentials: "include" });
            const j = await r.json();
            if (j.code !== 0) throw new Error(j.message);
            return { data: j.data.list as RecycleRow[], total: j.data.total, success: true };
          }}
          options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile }}
          columns={recycleColumns}
        />
      )}
    </Page>
  );
}
