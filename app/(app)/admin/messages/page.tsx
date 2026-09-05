"use client";
// 消息归档管理 (v0.25.3 重做: 与通知中心简洁化对齐, 类型全中文标签)
//
// 后端: GET /api/admin/messages-archive?mode=archive|recycle
//   - archive: MessageArchive (read+90d cron 写入)
//   - recycle: Message with deletedAt != null (用户软删, 30 天后由 cron hard delete)
//
// 操作: 移到收件箱 (archive) / 恢复 (recycle) / 彻底删除 (recycle, 跳过 30 天)
//
// v0.25.3 相对 v0.24.0 的变更:
//   - 类型列由英文枚举 Tag 改为 StatusTag(domain=message) 中文标签 + 语义色
//   - 类型筛选下拉由英文枚举改为 getStatusOptions("message") 中文选项
//   - 归档月份筛选由原生 <input type=month> 换为 antd DatePicker(picker=month, 可清空)
//   - 工具栏控件统一 antd, 紧凑对齐通知中心风格; 空状态文案入 i18n
import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import {
  Empty,
  Typography,
  Card,
  Input,
  Space,
  Select,
  Segmented,
  Button,
  Popconfirm,
  App as AntdApp,
  DatePicker
} from "antd";
import {
  SearchOutlined,
  UndoOutlined,
  InboxOutlined,
  DeleteFilled
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";
import { DateTimeCell } from "@/components/table-cells";
import { StatusTag } from "@/components/status-tag";
import { buildMessageLinkHref } from "@/lib/message-link";
import { getStatusOptions } from "@/lib/status";

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

/** 消息类型下拉: 中文 label, 枚举 value (与 lib/status.ts 对齐) */
const MESSAGE_TYPE_OPTIONS = getStatusOptions("message");

export default function AdminMessagesArchivePage() {
  const t = useT();
  const { isMobile } = useResponsive();
  const { message: msg } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const [mode, setMode] = useState<Mode>("archive");
  // 归档月份 (YYYY-MM), 空串 = 全部月份
  const [month, setMonth] = useState<string>(() =>
    dayjs().format("YYYY-MM")
  );
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
          msg.success(
            action === "restore"
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
        width: 130,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
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
        width: 150,
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
          return href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {t("admin.messagesArchive.action.view")}
            </a>
          ) : (
            "—"
          );
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
        width: 130,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
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
        width: 150,
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
      <Card size="small" styles={{ body: { padding: 8 } }} style={{ marginBottom: 8 }}>
        <Space wrap size={8}>
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
            <DatePicker
              picker="month"
              allowClear
              value={month ? dayjs(month + "-01") : null}
              onChange={(d: Dayjs | null) => {
                setMonth(d ? d.format("YYYY-MM") : "");
                setSelectedRowKeys([]);
              }}
              placeholder={t("admin.messagesArchive.filter.month")}
            />
          ) : null}
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 220 }}
            placeholder={t("admin.messagesArchive.filter.typesPlaceholder")}
            value={types}
            onChange={(v) => {
              setTypes(v as string[]);
              setSelectedRowKeys([]);
            }}
            options={MESSAGE_TYPE_OPTIONS}
            maxTagCount={isMobile ? 1 : 3}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 180 }}
            placeholder={t("admin.messagesArchive.filter.receiver")}
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
            style={{ width: isMobile ? "100%" : 240 }}
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
                description={t("admin.messagesArchive.empty.archive")}
              />
            )
          }}
          request={async (params) => {
            const qs = new URLSearchParams();
            qs.set("page", String(params.current ?? 1));
            qs.set("pageSize", String(params.pageSize ?? 20));
            qs.set("mode", "archive");
            if (month) qs.set("month", month);
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
