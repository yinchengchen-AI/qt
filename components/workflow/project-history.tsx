"use client";
// P_ProjectHistory: 项目详情页 - 项目级工作流活动流
// - 拉 /api/projects/{id}/history,含项目级动作 + 全部任务实例动作
// - 每条 Timeline 项:
//     1) 顶部 Task Context 行(instanceId 非空时):任务码 + 任务名(只读)
//     2) 中部:Action Tag + 操作人 + 时间(紧凑 + 完整 Tooltip)
//     3) 底部:diff 行(状态/二审翻译、assigneeId UUID 翻中文、结构化字段只显示"已变更")
// - 项目级动作(如 WORKFLOW_INSTANTIATE)instanceId = null,不显示任务行
// - 数据空闲/空态:Skeleton / Empty "暂无活动"

import useSWR from "swr";
import { Empty, Skeleton, Space, Tag, Timeline, Tooltip, Typography } from "antd";
import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ForwardOutlined,
  HistoryOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UserOutlined,
  UserSwitchOutlined
} from "@ant-design/icons";
import { WORKFLOW_TASK_STATUS_MAP, WORKFLOW_REVIEW_STATUS_MAP } from "@/lib/enum-maps";
import { useUserLookup } from "@/lib/user-lookup";
import type { LookupUser } from "@/lib/user-lookup";

const { Text } = Typography;

export type ProjectHistoryEntry = {
  id: string;
  action: string;
  actorId: string;
  actorName: string | null;
  at: string;
  diff: { before: unknown; after: unknown } | null;
  /** 项目级动作没有关联任务实例,此时 instanceId = null */
  instanceId: string | null;
  taskName: string | null;
  taskCode: string | null;
};

// diff 里出现的所有"字段名"统一映射成中文;未知 key 兜底显示原文
const BEFORE_LABEL: Record<string, string> = {
  status: "状态",
  assigneeId: "指派人",
  reviewStatus: "二审状态",
  remark: "备注",
  attachments: "附件列表",
  attachmentId: "附件",
  name: "附件名",
  templateId: "模板",
  serviceType: "服务类型",
  count: "数量",
  force: "强制",
  taskId: "任务模板",
  wouldCompleteAt: "预计完成",
  projectEndDate: "项目结束日",
  generated: "已生成",
  skipped: "已跳过"
};

// 15 种动作的「色 + 图标 + 中文标签」,Timeline dot + Tag 共用
type ActionMeta = { color: string; icon: React.ReactNode; label: string };
const ACTION_META: Record<string, ActionMeta> = {
  WORKFLOW_INSTANTIATE: { color: "purple", icon: <RocketOutlined />, label: "模板实例化" },
  WORKFLOW_TASK_START: { color: "blue", icon: <PlayCircleOutlined />, label: "开始任务" },
  WORKFLOW_TASK_COMPLETE: { color: "green", icon: <CheckCircleOutlined />, label: "完成任务" },
  WORKFLOW_TASK_BLOCK: { color: "red", icon: <StopOutlined />, label: "阻塞任务" },
  WORKFLOW_TASK_UNBLOCK: { color: "orange", icon: <ThunderboltOutlined />, label: "解除阻塞" },
  WORKFLOW_TASK_SKIP: { color: "gray", icon: <ForwardOutlined />, label: "跳过任务" },
  WORKFLOW_TASK_ASSIGN: { color: "purple", icon: <UserSwitchOutlined />, label: "重新指派" },
  WORKFLOW_TASK_REMARK: { color: "cyan", icon: <EditOutlined />, label: "更新备注" },
  WORKFLOW_TASK_ATTACHMENT_ADD: { color: "cyan", icon: <PaperClipOutlined />, label: "新增附件" },
  WORKFLOW_TASK_ATTACHMENT_REMOVE: { color: "red", icon: <DeleteOutlined />, label: "删除附件" },
  WORKFLOW_REVIEW_SUBMIT: { color: "blue", icon: <AuditOutlined />, label: "提交校核" },
  WORKFLOW_REVIEW_APPROVE: { color: "green", icon: <CheckCircleOutlined />, label: "审核通过" },
  WORKFLOW_REVIEW_REJECT: { color: "red", icon: <CloseCircleOutlined />, label: "驳回校核" },
  WORKFLOW_RECURRING_GENERATE: { color: "blue", icon: <ReloadOutlined />, label: "循环生成" },
  WORKFLOW_RECURRING_GENERATE_PARENT: { color: "blue", icon: <ReloadOutlined />, label: "循环实例" }
};

// 紧凑时间:今天只显示 HH:MM + 「今天」前缀;同年内 M-D HH:MM;跨年完整日期
function formatAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}-${d.getDate()} ${hh}:${mm}`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${hh}:${mm}`;
}

// 枚举值映射:状态 / 二审 走 enum-maps 里的中文表,DiffRow 复用即可
const DIFF_VALUE_LABEL: Record<string, string> = {
  ...WORKFLOW_TASK_STATUS_MAP,
  ...WORKFLOW_REVIEW_STATUS_MAP
};

// 哪些 key 的"值"是结构化数据(JSON 列表),展开会刷屏,统一显示"已变更"
const STRUCTURED_DIFF_KEYS = new Set(["attachments"]);

function DiffRow({ rowKey, before, after }: { rowKey: string; before: string; after: string }) {
  const label = BEFORE_LABEL[rowKey] ?? rowKey;
  if (STRUCTURED_DIFF_KEYS.has(rowKey)) {
    return (
      <div style={{ fontSize: 12, lineHeight: 1.9 }}>
        <Text type="secondary" style={{ marginRight: 6 }}>{label}:</Text>
        <Text>已变更</Text>
      </div>
    );
  }
  // status / reviewStatus 的 value 是枚举代码,翻成中文再显示
  const translateValue = (v: string) =>
    rowKey === "status" || rowKey === "reviewStatus" ? DIFF_VALUE_LABEL[v] ?? v : v;
  const renderVal = (v: string, isBefore: boolean) => {
    const raw = translateValue(v);
    if (!raw || raw === "—") {
      return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
    }
    const display = raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
    const node = isBefore ? (
      <Text delete type="danger" style={{ fontSize: 12 }}>{display}</Text>
    ) : (
      <Text strong type="success" style={{ fontSize: 12 }}>{display}</Text>
    );
    return display.length < raw.length ? (
      <Tooltip title={raw} placement="top">{node}</Tooltip>
    ) : (
      node
    );
  };
  return (
    <div style={{ fontSize: 12, lineHeight: 1.9 }}>
      <Text type="secondary" style={{ marginRight: 6 }}>{label}:</Text>
      {renderVal(before, true)}
      <Text type="secondary" style={{ margin: "0 6px" }}>→</Text>
      {renderVal(after, false)}
    </div>
  );
}

function diffForDisplay(diff: { before: unknown; after: unknown } | null): { key: string; before: string; after: string }[] {
  if (!diff) return [];
  const b = (diff.before ?? {}) as Record<string, unknown>;
  const a = (diff.after ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
  const rows: { key: string; before: string; after: string }[] = [];
  for (const k of keys) {
    const before = String(b[k] ?? "—");
    const after = String(a[k] ?? "—");
    if (before === after) continue;
    rows.push({ key: k, before, after });
  }
  return rows;
}

// 历史 diff 里有 assigneeId 这种 UUID 字段,转成中文名再展示
function resolveIdsInDiff(
  rows: { key: string; before: string; after: string }[],
  userMap: Map<string, LookupUser>
): { key: string; before: string; after: string }[] {
  return rows.map((r) => {
    if (r.key !== "assigneeId") return r;
    const lookup = (v: string) => {
      if (!v || v === "—") return v;
      const u = userMap.get(v);
      if (!u) return v;
      return u.name;
    };
    return { key: r.key, before: lookup(r.before), after: lookup(r.after) };
  });
}

export function ProjectHistory({ projectId, canEdit: _canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading } = useSWR<{ items: ProjectHistoryEntry[] }>(`/api/projects/${projectId}/history`);
  const userNameMap = useUserLookup();

  if (isLoading) return <Skeleton active />;
  const items = data?.items ?? [];
  if (items.length === 0) {
    return <Empty description="暂无活动" />;
  }

  return (
    <>
      <Timeline
        style={{ marginTop: 8 }}
        items={items.map((h) => {
          const meta = ACTION_META[h.action] ?? { color: "blue", icon: <HistoryOutlined />, label: h.action };
          const diffRows = resolveIdsInDiff(diffForDisplay(h.diff), userNameMap);
          return {
            key: h.id,
            color: meta.color,
            icon: meta.icon,
            content: (
              <div>
                {/* 任务上下文(项目级动作为 null,跳过)— 只读,不再弹抽屉 */}
                {h.instanceId && (
                  <div style={{ marginBottom: 4 }}>
                    <Space size={6}>
                      {h.taskCode && <Tag style={{ margin: 0 }}>{h.taskCode}</Tag>}
                      {h.taskName ? (
                        <Text strong style={{ fontSize: 13 }}>{h.taskName}</Text>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>任务 #{h.instanceId.slice(0, 8)}</Text>
                      )}
                    </Space>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>
                  <Space size={4}>
                    <UserOutlined />
                    <span style={{ fontSize: 12 }}>{h.actorName ?? h.actorId.slice(0, 8)}</span>
                  </Space>
                  <Tooltip title={new Date(h.at).toLocaleString("zh-CN")} placement="top">
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatAt(h.at)}</Text>
                  </Tooltip>
                </div>
                {diffRows.length > 0 && (
                  <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid #f0f0f0" }}>
                    {diffRows.map((r, i) => (
                      <DiffRow key={i} rowKey={r.key} before={r.before} after={r.after} />
                    ))}
                  </div>
                )}
              </div>
            )
          };
        })}
      />
    </>
  );
}
