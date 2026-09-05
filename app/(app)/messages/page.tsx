"use client";
// 通知中心 v3 (2026-09-05 消息与公告模块重构)
//
// v3 相对 v2 的变更:
//   - 侧边栏"消息与公告"分组合并为"通知中心"单入口 (更新日志移入"系统"分组, 见 dashboard-shell MENU)
//   - Tabs 新增「公告」: 公告阅读 + 管理一体 (ADMIN/OPS 可发布/编辑/删除), 组件化在 components/notifications/announcement-tab.tsx
//   - deep link 支持 ?tab=announcements|archive|recycle
//
// v2 (2026-09-03) 保留能力:
//   - 左侧分类 sidebar (全部 / 合同 / 财务 / 对账 / 证书 / 系统),从 /unread-summary 拉分类未读计数
//   - 顶部 toolbar: 搜索 + 类型多选 + 状态 tab + 日期范围
//   - 批量操作: 勾选行后出现 batch bar (mark read / delete)
//   - row click = 标记已读 + 跳转到 link
//   - message:new SSE 事件: 直接 prepend 到列表顶部 (无重拉)
//   - 订阅设置: 顶部"订阅"按钮打开 Drawer
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
  Typography,
  Card,
  Skeleton,
  Input,
  Drawer,
  Switch,
  Divider,
  DatePicker,
  Popconfirm,
  Spin,
  Badge,
  Select
} from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  LinkOutlined,
  SearchOutlined,
  SettingOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UndoOutlined,
  InboxOutlined,
  DeleteFilled
} from "@ant-design/icons";
import Link from "next/link";
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
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
import { MESSAGE_CATEGORY, categoryOf } from "@/lib/message-categories";
import type {
  MessageRowPayload,
  UnreadSummary,
  MessagePreferenceRow
} from "@/lib/message-types";
import { type Dayjs } from "dayjs";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

type TabKey = "all" | "unread" | "read" | "announcements" | "archive" | "recycle";
type SelectedCategory = string | "all";

type ListResp = {
  list: MessageRowPayload[];
  total?: number;
  nextCursor: string | null;
  unreadCount: number;
};

type ArchiveRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | Record<string, unknown> | null;
  createdAt: string;
  archivedAt: string;
};

type RecycleRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
  deletedAt: string;
};

type PinnedAnnouncement = { id: string; title: string; content: string; publishAt: string };

export default function MessagesPage() {
  const t = useT();
  const { message: msg, modal } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const actionRef = useRef<ActionType>(undefined);
  const archiveActionRef = useRef<ActionType>(undefined);
  const recycleActionRef = useRef<ActionType>(undefined);
  const [archiveSelectedRowKeys, setArchiveSelectedRowKeys] = useState<React.Key[]>([]);
  const [recycleSelectedRowKeys, setRecycleSelectedRowKeys] = useState<React.Key[]>([]);
  const searchParams = useSearchParams();
  // v0.24.0: 支持 ?tab=archive|recycle deep link
  const initialTab = ((): TabKey => {
    const t = searchParams.get("tab");
    if (t === "announcements" || t === "archive" || t === "recycle") return t;
    return "all";
  })();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<SelectedCategory>("all");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [data, setData] = useState<MessageRowPayload[]>([]);
  const [summary, setSummary] = useState<UnreadSummary | null>(null);
  const [pinned, setPinned] = useState<PinnedAnnouncement[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(true);
  const [prefOpen, setPrefOpen] = useState(false);
  const [prefs, setPrefs] = useState<MessagePreferenceRow[] | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);

  const unreadCount = useUnreadCount();

  const reloadSummary = useCallback(async () => {
    try {
      const r = await fetch("/api/messages/unread-summary", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setSummary(j.data as UnreadSummary);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    reloadSummary();
  }, [reloadSummary]);

  // 提交搜索（防抖 400ms）
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  // 加载 pinned 公告
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/announcements/pinned", { credentials: "include" });
        const j = await r.json();
        if (j.code === 0) setPinned(j.data?.list ?? []);
      } catch {
        /* empty */
      }
      setPinnedLoading(false);
    })();
  }, []);

  // SSE 实时推送
  useMessageStream({
    onKick: () => {
      actionRef.current?.reload?.();
      refreshUnread();
      reloadSummary();
    },
    onNewMessage: (row) => {
      // 仅 prepend 到列表顶部（去重 + 仅未读）
      setData((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        // 过滤 category / tab 命中才进
        if (category !== "all" && categoryOf(row.type) !== category) return prev;
        if (tab === "read" && !row.readAt) return prev;
        return [row, ...prev];
      });
      refreshUnread();
      reloadSummary();
    }
  });

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true);
    try {
      const r = await fetch("/api/messages/preferences", { credentials: "include" });
      const j = await r.json();
      if (j.code === 0) setPrefs(j.data.preferences as MessagePreferenceRow[]);
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (prefOpen && !prefs) loadPrefs();
  }, [prefOpen, prefs, loadPrefs]);

  const updatePref = useCallback(
    async (type: string, enabled: boolean) => {
      const next = (prefs ?? []).map((p) =>
        p.type === type ? { ...p, enabled } : p
      );
      setPrefs(next);
      try {
        const r = await fetch("/api/messages/preferences", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: next.map((p) => ({ type: p.type, enabled: p.enabled }))
          })
        });
        const j = await r.json();
        if (j.code !== 0) {
          msg.error(j.message ?? t("messages.toast.actionFailed"));
          setPrefs(prefs); // 回滚
        } else {
          msg.success(t("messages.preferences.saved"));
        }
      } catch {
        msg.error(t("messages.toast.actionFailed"));
        setPrefs(prefs);
      }
    },
    [prefs, msg, t]
  );

  const columns: ProColumns<MessageRowPayload>[] = useMemo(
    () => [
      {
        title: t("messages.column.status"),
        dataIndex: "readAt",
        width: 90,
        render: (_, r) =>
          r.readAt ? (
            <Tag icon={<CheckOutlined />} color="default" style={{ margin: 0 }}>
              {t("messages.tag.read")}
            </Tag>
          ) : (
            <Tag color="red" style={{ margin: 0 }}>
              {t("messages.tag.unread")}
            </Tag>
          )
      },
      {
        title: t("messages.column.type"),
        dataIndex: "type",
        width: 140,
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
                    const res = await fetch(`/api/messages/${r.id}`, {
                      method: "DELETE",
                      credentials: "include"
                    });
                    const j = await res.json();
                    if (j.code === 0) {
                      msg.success(t("messages.toast.deleted"));
                      actionRef.current?.reload?.();
                    } else msg.error(j.message);
                  }
                });
              }}
            >
              {t("messages.action.delete")}
            </Button>
          </Space>
        )
      }
    ],
    [t, msg, modal]
  );

  // 侧边栏分类
  const categoryItems: { key: SelectedCategory; label: React.ReactNode; count: number }[] = useMemo(
    () => [
      { key: "all", label: t("messages.category.all"), count: summary?.total ?? 0 },
      {
        key: MESSAGE_CATEGORY.CONTRACT,
        label: t("messages.category.contract"),
        count: summary?.byCategory[MESSAGE_CATEGORY.CONTRACT] ?? 0
      },
      {
        key: MESSAGE_CATEGORY.FINANCE,
        label: t("messages.category.finance"),
        count: summary?.byCategory[MESSAGE_CATEGORY.FINANCE] ?? 0
      },
      {
        key: MESSAGE_CATEGORY.RECONCILIATION,
        label: t("messages.category.reconciliation"),
        count: summary?.byCategory[MESSAGE_CATEGORY.RECONCILIATION] ?? 0
      },
      {
        key: MESSAGE_CATEGORY.CERTIFICATE,
        label: t("messages.category.certificate"),
        count: summary?.byCategory[MESSAGE_CATEGORY.CERTIFICATE] ?? 0
      },
      {
        key: MESSAGE_CATEGORY.SYSTEM,
        label: t("messages.category.system"),
        count: summary?.byCategory[MESSAGE_CATEGORY.SYSTEM] ?? 0
      }
    ],
    [t, summary]
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
      { key: "announcements", label: t("messages.tab.announcements") },
      { key: "archive", label: t("messages.tab.archive") },
      { key: "recycle", label: t("messages.tab.recycle") }
    ],
    [t, unreadCount]
  );

  const markAllRead = useCallback(async () => {
    try {
      const body: Record<string, unknown> = {};
      if (category !== "all") body.categories = [category];
      if (search) body.q = search;
      if (dateRange?.[0]) body.from = dateRange[0].toISOString();
      if (dateRange?.[1]) body.to = dateRange[1].toISOString();
      const r = await fetch("/api/messages/mark-all-read", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code === 0) {
        msg.success(t("messages.toast.markedRead", { n: j.data.updated }));
        actionRef.current?.reload?.();
        refreshUnread();
        reloadSummary();
      } else msg.error(j.message);
    } catch {
      msg.error(t("messages.toast.actionFailed"));
    }
  }, [category, search, dateRange, msg, t, reloadSummary]);

  const clearRead = useCallback(async () => {
    try {
      const body: Record<string, unknown> = {};
      if (category !== "all") body.categories = [category];
      if (search) body.q = search;
      if (dateRange?.[0]) body.from = dateRange[0].toISOString();
      if (dateRange?.[1]) body.to = dateRange[1].toISOString();
      const r = await fetch("/api/messages/read/clear", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code === 0) {
        msg.success(t("messages.toast.clearedRead", { n: j.data.deleted }));
        actionRef.current?.reload?.();
        reloadSummary();
      } else msg.error(j.message);
    } catch {
      msg.error(t("messages.toast.actionFailed"));
    }
  }, [category, search, dateRange, msg, t, reloadSummary]);

  // Archive: move selected to inbox (user-side, owner only)
  const moveToInbox = useCallback(
    async (ids: React.Key[]) => {
      if (ids.length === 0) return;
      try {
        let ok = 0;
        for (const id of ids) {
          const r = await fetch(`/api/messages/archive/${String(id)}/restore`, {
            method: "POST",
            credentials: "include"
          });
          const j = await r.json();
          if (j.code === 0) ok++;
        }
        msg.success(t("messages.toast.movedToInbox", { n: ok }));
        setArchiveSelectedRowKeys([]);
        archiveActionRef.current?.reload?.();
        refreshUnread();
        reloadSummary();
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      }
    },
    [msg, t, reloadSummary]
  );

  // Recycle: restore selected to inbox
  const restoreRecycled = useCallback(
    async (ids: React.Key[]) => {
      if (ids.length === 0) return;
      try {
        const r = await fetch("/api/messages/batch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, action: "restore" })
        });
        const j = await r.json();
        if (j.code === 0) {
          msg.success(t("messages.toast.restored", { n: j.data.affected }));
          setRecycleSelectedRowKeys([]);
          recycleActionRef.current?.reload?.();
        } else msg.error(j.message);
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      }
    },
    [msg, t]
  );

  // Recycle: purge selected (hard delete)
  const purgeRecycled = useCallback(
    async (ids: React.Key[]) => {
      if (ids.length === 0) return;
      try {
        const r = await fetch("/api/messages/batch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, action: "purge" })
        });
        const j = await r.json();
        if (j.code === 0) {
          msg.success(t("messages.toast.purged", { n: j.data.affected }));
          setRecycleSelectedRowKeys([]);
          recycleActionRef.current?.reload?.();
        } else msg.error(j.message);
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      }
    },
    [msg, t]
  );

  const batchAction = useCallback(
    async (action: "markRead" | "delete") => {
      if (selectedRowKeys.length === 0) return;
      try {
        const r = await fetch("/api/messages/batch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedRowKeys, action })
        });
        const j = await r.json();
        if (j.code === 0) {
          msg.success(
            action === "markRead"
              ? t("messages.toast.bulkRead", { n: j.data.affected })
              : t("messages.toast.bulkDeleted", { n: j.data.affected })
          );
          setSelectedRowKeys([]);
          actionRef.current?.reload?.();
          refreshUnread();
          reloadSummary();
        } else msg.error(j.message);
      } catch {
        msg.error(t("messages.toast.actionFailed"));
      }
    },
    [selectedRowKeys, msg, t, reloadSummary]
  );

  // ============= Archive tab columns =============
  const archiveColumns: ProColumns<ArchiveRow>[] = useMemo(
    () => [
      {
        title: t("messages.column.type"),
        dataIndex: "type",
        width: 140,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
      },
      {
        title: t("messages.column.message"),
        dataIndex: "title",
        width: 360,
        render: (_, r) => (
          <div style={{ minWidth: 0 }}>
            <Text strong style={{ display: "block" }}>{r.title}</Text>
            {r.content ? (
              <Text type="secondary" style={{ fontSize: 12, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 2 }}>
                {r.content}
              </Text>
            ) : null}
          </div>
        )
      },
      {
        title: t("messages.column.time"),
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
        width: 160,
        render: (_, r) => {
          const href = r.link ? buildLinkHref(r.link as never) : null;
          return (
            <Space size={4}>
              {href ? <Button type="link" size="small" icon={<LinkOutlined />} href={href} target="_blank" rel="noreferrer">{t("messages.action.view")}</Button> : null}
              <Popconfirm
                title={t("admin.messagesArchive.confirm.moveToInbox")}
                okText={t("messages.action.moveToInbox")}
                cancelText={t("announcements.cancel")}
                onConfirm={() => moveToInbox([r.id])}
              >
                <Button type="link" size="small" icon={<InboxOutlined />}>
                  {t("messages.action.moveToInbox")}
                </Button>
              </Popconfirm>
            </Space>
          );
        }
      }
    ],
    [t, moveToInbox]
  );

  // ============= Recycle tab columns =============
  const recycleColumns: ProColumns<RecycleRow>[] = useMemo(
    () => [
      {
        title: t("messages.column.status"),
        dataIndex: "readAt",
        width: 80,
        render: (_, r) =>
          r.readAt ? (
            <Tag icon={<CheckOutlined />} color="default" style={{ margin: 0 }}>
              {t("messages.tag.read")}
            </Tag>
          ) : (
            <Tag color="red" style={{ margin: 0 }}>
              {t("messages.tag.unread")}
            </Tag>
          )
      },
      {
        title: t("messages.column.type"),
        dataIndex: "type",
        width: 140,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
      },
      {
        title: t("messages.column.message"),
        dataIndex: "title",
        width: 320,
        render: (_, r) => (
          <div style={{ minWidth: 0 }}>
            <Text strong={!r.readAt} style={{ display: "block" }}>{r.title}</Text>
            {r.content ? (
              <Text type="secondary" style={{ fontSize: 12, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 2 }}>
                {r.content}
              </Text>
            ) : null}
          </div>
        )
      },
      {
        title: t("messages.column.time"),
        dataIndex: "createdAt",
        width: 140,
        render: (_, r) => <DateTimeCell value={r.createdAt} />
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
        render: (_, r) => {
          const href = r.link ? buildLinkHref(r.link as never) : null;
          return (
            <Space size={4}>
              {href ? <Button type="link" size="small" icon={<LinkOutlined />} href={href} target="_blank" rel="noreferrer">{t("messages.action.view")}</Button> : null}
              <Popconfirm
                title={t("messages.recycle.restoreConfirm.title")}
                description={t("messages.recycle.restoreConfirm.content")}
                okText={t("messages.action.restore")}
                cancelText={t("announcements.cancel")}
                onConfirm={() => restoreRecycled([r.id])}
              >
                <Button type="link" size="small" icon={<UndoOutlined />}>
                  {t("messages.action.restore")}
                </Button>
              </Popconfirm>
              <Popconfirm
                title={t("messages.recycle.purgeConfirm.title")}
                description={t("messages.recycle.purgeConfirm.content")}
                okText={t("messages.action.purge")}
                okType="danger"
                cancelText={t("announcements.cancel")}
                onConfirm={() => purgeRecycled([r.id])}
              >
                <Button type="link" size="small" danger icon={<DeleteFilled />}>
                  {t("messages.action.purge")}
                </Button>
              </Popconfirm>
            </Space>
          );
        }
      }
    ],
    [t, restoreRecycled, purgeRecycled]
  );

  return (
    <Page>
      <PageHeader
        title={t("messages.title")}
        subtitle={t("messages.subtitle")}
        actions={
          tab === "announcements" ? undefined : (
          <Space wrap>
            <Button
              key="prefs"
              icon={<SettingOutlined />}
              onClick={() => setPrefOpen(true)}
            >
              {t("messages.preferences.title")}
            </Button>
            <Button
              key="all"
              icon={<CheckOutlined />}
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              {t("messages.markAllRead")}
            </Button>
            <Popconfirm
              key="clear"
              title={t("messages.clearReadConfirm.title")}
              description={t("messages.clearReadConfirm.content")}
              okText={t("messages.action.clearRead")}
              okType="danger"
              cancelText={t("announcements.cancel")}
              onConfirm={clearRead}
            >
              <Button icon={<DeleteOutlined />} danger>
                {t("messages.action.clearRead")}
              </Button>
            </Popconfirm>
          </Space>
          )
        }
      />

      {tab !== "announcements" ? (
        pinnedLoading ? (
          <Card size="small" style={{ marginBottom: 12 }}>
            <Skeleton active paragraph={{ rows: 1 }} />
          </Card>
        ) : pinned.length > 0 ? (
          <Card
            size="small"
            title={
              <Space size={6}>
                {t("messages.pinned.title")}
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            {pinned.map((p) => (
              <div key={p.id} style={{ marginBottom: 8 }}>
                <Text strong>{p.title}</Text>
                <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                  {p.content}
                </Paragraph>
              </div>
            ))}
          </Card>
        ) : null
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 12,
          flexDirection: isMobile ? "column" : "row",
          alignItems: "stretch",
          marginBottom: 12
        }}
      >
        {!isMobile && tab !== "announcements" && (
          <Card
            size="small"
            styles={{ body: { padding: 8 } }}
            style={{ width: 200, flexShrink: 0 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {categoryItems.map((c) => {
                const active = category === c.key;
                return (
                  <Button
                    key={c.key}
                    type={active ? "primary" : "text"}
                    onClick={() => {
                      setCategory(c.key);
                      setSelectedRowKeys([]);
                      actionRef.current?.reload?.();
                    }}
                    style={{ justifyContent: "space-between" }}
                    block
                  >
                    <span>{c.label}</span>
                    {c.count > 0 ? (
                      <Badge
                        count={c.count}
                        style={{ backgroundColor: active ? "#fff" : undefined, color: active ? "var(--ant-color-primary)" : undefined }}
                      />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          </Card>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {(tab === "all" || tab === "unread" || tab === "read") && (
          <Card size="small" styles={{ body: { padding: 8 } }} style={{ marginBottom: 8 }}>
            <Space wrap size={8}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t("messages.toolbar.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: 240 }}
              />
              <RangePicker
                value={dateRange}
                onChange={(v) => {
                  setDateRange(v);
                  setSelectedRowKeys([]);
                }}
                allowEmpty={[true, true]}
                placeholder={[t("messages.toolbar.from"), t("messages.toolbar.to")]}
              />
              {isMobile ? (
                <SelectCategoryMobile
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setSelectedRowKeys([]);
                  }}
                  items={categoryItems.map((c) => ({ value: c.key, label: typeof c.label === "string" ? c.label : String(c.key), count: c.count }))}
                />
              ) : null}
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  actionRef.current?.reload?.();
                  reloadSummary();
                }}
              >
                {t("messages.toolbar.refresh")}
              </Button>
            </Space>
          </Card>
          )}
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
                setSelectedRowKeys([]);
                actionRef.current?.reload?.();
              }}
              items={tabs}
              size={isMobile ? "small" : "middle"}
              tabBarStyle={{ marginBottom: 0 }}
            />
          </div>
          {selectedRowKeys.length > 0 ? (
            <Card
              size="small"
              style={{
                marginBottom: 8,
                background: "var(--ant-color-primary-bg, #e6f4ff)",
                border: "1px solid var(--ant-color-primary-border, #91caff)"
              }}
            >
              <Space>
                <Text strong>{t("messages.batch.selected", { n: selectedRowKeys.length })}</Text>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => batchAction("markRead")}
                >
                  {t("messages.batch.markRead")}
                </Button>
                <Popconfirm
                  title={t("messages.recycle.moveConfirm.title")}
                  description={t("messages.recycle.moveConfirm.content")}
                  okText={t("messages.action.moveToRecycle")}
                  okType="danger"
                  cancelText={t("announcements.cancel")}
                  onConfirm={() => batchAction("delete")}
                >
                  <Button danger size="small" icon={<DeleteOutlined />}>
                    {t("messages.batch.moveToRecycle")}
                  </Button>
                </Popconfirm>
                <Button size="small" onClick={() => setSelectedRowKeys([])}>
                  {t("messages.batch.clear")}
                </Button>
              </Space>
            </Card>
          ) : null}
          {tab === "announcements" ? (
            <AnnouncementTab />
          ) : tab === "all" || tab === "unread" || tab === "read" ? (
            <ProTable<MessageRowPayload>
              key={`${tab}-${category}-${search}-${dateRange?.[0]?.toISOString() ?? ""}-${dateRange?.[1]?.toISOString() ?? ""}`}
              actionRef={actionRef}
              rowKey="id"
              search={false}
              dataSource={data}
              onDataSourceChange={setData}
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
                if (category !== "all") qs.set("categories", category);
                if (search) qs.set("q", search);
                if (dateRange?.[0]) qs.set("from", dateRange[0].toISOString());
                if (dateRange?.[1]) qs.set("to", dateRange[1].toISOString());
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
              options={{
                reload: () => actionRef.current?.reload?.(),
                density: !isMobile,
                fullScreen: !isMobile
              }}
              columns={columns}
            />
          ) : tab === "archive" ? (
            <ProTable<ArchiveRow>
              key={`archive-${category}-${search}-${dateRange?.[0]?.toISOString() ?? ""}-${dateRange?.[1]?.toISOString() ?? ""}`}
              actionRef={archiveActionRef}
              rowKey="id"
              search={false}
              rowSelection={{
                selectedRowKeys: archiveSelectedRowKeys,
                onChange: setArchiveSelectedRowKeys
              }}
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
                    description={t("messages.archive.empty")}
                  />
                )
              }}
              request={async (params) => {
                const qs = new URLSearchParams();
                qs.set("page", String(params.current ?? 1));
                qs.set("pageSize", String(params.pageSize ?? 20));
                if (category !== "all") qs.set("categories", category);
                if (search) qs.set("q", search);
                if (dateRange?.[0]) qs.set("from", dateRange[0].toISOString());
                if (dateRange?.[1]) qs.set("to", dateRange[1].toISOString());
                const r = await fetch(`/api/messages/archive?${qs}`, { credentials: "include" });
                const j = await r.json();
                if (j.code !== 0) throw new Error(j.message);
                return {
                  data: (j.data.list as ArchiveRow[]),
                  total: j.data.total ?? 0,
                  success: true
                };
              }}
              options={{ reload: () => archiveActionRef.current?.reload?.(), density: !isMobile }}
              columns={archiveColumns}
            />
          ) : (
            <ProTable<RecycleRow>
              key={`recycle-${category}-${search}-${dateRange?.[0]?.toISOString() ?? ""}-${dateRange?.[1]?.toISOString() ?? ""}`}
              actionRef={recycleActionRef}
              rowKey="id"
              search={false}
              rowSelection={{
                selectedRowKeys: recycleSelectedRowKeys,
                onChange: setRecycleSelectedRowKeys
              }}
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
                    description={t("messages.recycle.empty")}
                  />
                )
              }}
              request={async (params) => {
                const qs = new URLSearchParams();
                qs.set("page", String(params.current ?? 1));
                qs.set("pageSize", String(params.pageSize ?? 20));
                if (category !== "all") qs.set("categories", category);
                if (search) qs.set("q", search);
                if (dateRange?.[0]) qs.set("from", dateRange[0].toISOString());
                if (dateRange?.[1]) qs.set("to", dateRange[1].toISOString());
                const r = await fetch(`/api/messages/recycle?${qs}`, { credentials: "include" });
                const j = await r.json();
                if (j.code !== 0) throw new Error(j.message);
                return {
                  data: (j.data.list as RecycleRow[]),
                  total: j.data.total ?? 0,
                  success: true
                };
              }}
              options={{ reload: () => recycleActionRef.current?.reload?.(), density: !isMobile }}
              columns={recycleColumns}
            />
          )}
        </div>
      </div>

      <Drawer
        open={prefOpen}
        onClose={() => setPrefOpen(false)}
        title={t("messages.preferences.drawerTitle")}
        width={isMobile ? "100%" : 480}
      >
        {prefsLoading ? (
          <Spin />
        ) : !prefs ? (
          <Empty description={t("messages.preferences.empty")} />
        ) : (
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              {t("messages.preferences.description")}
            </Text>
            {prefs.map((p, idx) => (
              <div key={p.type}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0"
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <StatusTag status={p.type} domain="message" />
                  </div>
                  <Switch
                    checked={p.enabled}
                    onChange={(v) => updatePref(p.type, v)}
                    checkedChildren={t("messages.preferences.enabled")}
                    unCheckedChildren={t("messages.preferences.disabled")}
                  />
                </div>
                {idx < prefs.length - 1 ? <Divider style={{ margin: 0 }} /> : null}
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </Page>
  );
}

function SelectCategoryMobile({
  value,
  onChange,
  items
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string; count: number }[];
}) {
  const t = useT();
  return (
    <Select
      value={value}
      onChange={onChange}
      style={{ minWidth: 140 }}
      options={items.map((i) => ({
        value: i.value,
        label: (
          <Space>
            <span>{i.label}</span>
            {i.count > 0 ? <Badge count={i.count} /> : null}
          </Space>
        )
      }))}
      suffixIcon={<AppstoreOutlined />}
      placeholder={t("messages.toolbar.categoryFilter")}
    />
  );
}
