"use client";
// 通知中心 v4 (2026-09-05 简洁实用重构)
//
// v4 相对 v3 的简化 (用户反馈: 要求简洁实用):
//   - 删除左侧分类侧栏(6 个大按钮 + 徽标), 分类筛选并入工具栏一个紧凑 Select(带未读计数)
//   - 主列表删除独立"状态"列, 未读用行内红点 + 标题加粗表达, 减少列噪
//   - 布局由"侧栏 + 主区"双栏改单列, 视觉重心收敛到 Tabs + 列表
//   - 移动端复用同一分类 Select (删除 SelectCategoryMobile 专用组件)
//
// v3 (2026-09-05 消息与公告模块重构) 保留:
//   - 侧边栏"消息与公告"分组合并为"通知中心"单入口 (更新日志移入"系统"分组, 见 dashboard-shell MENU)
//   - Tabs 含「公告」: 公告阅读 + 管理一体 (ADMIN/OPS 可发布/编辑/删除), 组件化在 components/notifications/announcement-tab.tsx
//   - deep link 支持 ?tab=announcements|archive|recycle
//
// v2 (2026-09-03) 保留能力:
//   - 顶部 toolbar: 搜索 + 分类筛选 + 状态 tab + 日期范围
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
  Select
} from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  LinkOutlined,
  SearchOutlined,
  SettingOutlined,
  ReloadOutlined,
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
  // v0.24.0: 支持 ?tab=archive|recycle deep link; v3: +?tab=announcements
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

  // 主列表列 (v4: 去掉独立"状态"列, 未读 = 红点 + 标题加粗)
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
        width: 220,
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

  // 分类筛选 (v4: 从左侧侧栏收敛为工具栏 Select, 未读计数以文本展示)
  const categoryOptions: { value: SelectedCategory; label: string }[] = useMemo(
    () => [
      { value: "all", label: t("messages.category.all") },
      {
        value: MESSAGE_CATEGORY.CONTRACT,
        label: t("messages.category.contract")
      },
      {
        value: MESSAGE_CATEGORY.FINANCE,
        label: t("messages.category.finance")
      },
      {
        value: MESSAGE_CATEGORY.RECONCILIATION,
        label: t("messages.category.reconciliation")
      },
      {
        value: MESSAGE_CATEGORY.CERTIFICATE,
        label: t("messages.category.certificate")
      },
      {
        value: MESSAGE_CATEGORY.SYSTEM,
        label: t("messages.category.system")
      }
    ],
    [t]
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
        width: 130,
        render: (_, r) => <StatusTag status={r.type} domain="message" />
      },
      {
        title: t("messages.column.message"),
        dataIndex: "title",
        width: 400,
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
        width: 150,
        render: (_, r) => <DateTimeCell value={r.createdAt} />
      },
      {
        title: t("admin.messagesArchive.column.archivedAt"),
        dataIndex: "archivedAt",
        width: 150,
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
        width: 130,
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
        width: 150,
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
                key="all"
                icon={<CheckOutlined />}
                disabled={unreadCount === 0}
                onClick={markAllRead}
              >
                {t("messages.markAllRead")}
              </Button>
              <Button
                key="prefs"
                icon={<SettingOutlined />}
                onClick={() => setPrefOpen(true)}
              >
                {t("messages.preferences.title")}
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

      <div style={{ marginBottom: 12 }}>
        {(tab === "all" || tab === "unread" || tab === "read") && (
          <Card size="small" styles={{ body: { padding: 8 } }} style={{ marginBottom: 8 }}>
            <Space wrap size={8}>
              <Select
                value={category}
                onChange={(v) => {
                  setCategory(v as SelectedCategory);
                  setSelectedRowKeys([]);
                }}
                style={{ minWidth: 150 }}
                options={categoryOptions.map((c) => ({
                  value: c.value,
                  label:
                    c.value === "all"
                      ? c.label
                      : `${c.label}${(summary?.byCategory[c.value] ?? 0) > 0 ? ` (${summary?.byCategory[c.value] ?? 0})` : ""}`
                }))}
              />
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t("messages.toolbar.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: isMobile ? 180 : 240 }}
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
