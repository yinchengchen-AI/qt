"use client";
// 项目详情右栏 — 任务历史卡
// 拉 /api/projects/[id]/task-history, 展示该项目下所有任务实例的状态变更流.
// 替换原 ProjectHistory 组件 (PR-1 期间随 diff/follow-ups/progress-log 一并删除).
//
// 设计: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §5.2
import useSWR from "swr";
import { Empty, List, Space, Tag, Typography } from "antd";
import { WORKFLOW_TASK_STATUS_MAP } from "@/lib/enum-maps";

const { Text } = Typography;

type TaskHistoryItem = {
  id: string;
  instanceId: string;
  taskName: string;
  taskCode: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  actorName: string | null;
  at: string;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  SKIPPED: "warning",
  BLOCKED: "error",
};

function actionLabel(action: string): string {
  switch (action) {
    case "WORKFLOW_TASK_START":    return "开始";
    case "WORKFLOW_TASK_COMPLETE": return "完成";
    case "WORKFLOW_TASK_BLOCK":    return "阻塞";
    case "WORKFLOW_TASK_UNBLOCK":  return "解阻";
    case "WORKFLOW_TASK_SKIP":     return "跳过";
    default: return action;
  }
}

export function TaskHistory({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSWR<{ items: TaskHistoryItem[] }>(
    `/api/projects/${projectId}/task-history`,
  );

  if (isLoading) {
    return <Text type="secondary">加载中…</Text>;
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务状态变更" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(it) => (
        <List.Item style={{ padding: "8px 0" }}>
          <Space orientation="vertical" size={2} style={{ width: "100%" }}>
            <Space size={6} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(it.at).toLocaleString("zh-CN")}
              </Text>
              <Text strong style={{ fontSize: 13 }}>{it.taskName}</Text>
            </Space>
            <Space size={4} wrap>
              {it.fromStatus && (
                <>
                  <Tag color={STATUS_TONE[it.fromStatus] ?? "default"} style={{ margin: 0 }}>
                    {WORKFLOW_TASK_STATUS_MAP[it.fromStatus] ?? it.fromStatus}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>→</Text>
                </>
              )}
              <Tag color={STATUS_TONE[it.toStatus] ?? "default"} style={{ margin: 0 }}>
                {WORKFLOW_TASK_STATUS_MAP[it.toStatus] ?? it.toStatus}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
              <Text style={{ fontSize: 12 }}>{actionLabel(it.action)}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
              <Text style={{ fontSize: 12 }}>{it.actorName ?? "(未知操作人)"}</Text>
            </Space>
          </Space>
        </List.Item>
      )}
    />
  );
}
