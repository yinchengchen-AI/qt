"use client";
// P9+P14: 工作流 Kanban 视图 — 5列按阶段,支持拖拽改状态 + 快捷操作
import useSWR from "swr";
import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App as AntdApp, Button, Dropdown, Empty, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import {
  LockOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  StopOutlined,
  UndoOutlined,
  ForwardOutlined,
  MoreOutlined
} from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { TaskDrawer } from "@/components/workflow/task-drawer";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  WORKFLOW_TASK_STATUS_TONE,
  WORKFLOW_PHASE_STATE_LABEL,
  WORKFLOW_PHASE_STATE_TONE,
  WORKFLOW_TASK_ACTION_LABEL,
  WORKFLOW_TASK_STATUS_SORT
} from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type KanbanTask = {
  id: string;
  name: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  assigneeId: string | null;
  requiresTwoStepReview: boolean;
  reviewStatus: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
  updatedAt: string;
};

type KanbanColumn = {
  phase: string;
  code: string;
  name: string;
  total: number;
  byStatus: { PENDING: number; IN_PROGRESS: number; BLOCKED: number; COMPLETED: number; SKIPPED: number };
  phaseState: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  tasks: KanbanTask[];
};

type Kanban = {
  projectId: string;
  projectName: string;
  projectNo: string;
  columns: KanbanColumn[];
  totals: { total: number; pending: number; inProgress: number; completed: number; blocked: number };
};



export default function WorkflowBoardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data, isLoading, mutate } = useSWR<Kanban>(
    params.get("projectId") ? `/api/projects/${params.get("projectId")}/workflow/board` : null
  );
  const [drawerTask, setDrawerTask] = useState<KanbanTask | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const { notification } = AntdApp.useApp();

  const callTaskAction = useCallback(async (
    taskId: string,
    action: "start" | "complete" | "block" | "unblock" | "skip"
  ) => {
    try {
      const res = await fetch(`/api/workflow-tasks/${taskId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { message?: string }).message ?? `操作失败 (${res.status})`);
      }
      notification.success({
        message: WORKFLOW_TASK_ACTION_LABEL[action] ? "已" + WORKFLOW_TASK_ACTION_LABEL[action] : action ?? action,
        placement: "topRight"
      });
      mutate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "操作失败";
      notification.error({ message: msg, placement: "topRight" });
    }
  }, [mutate, notification]);

  const handleDragStart = (e: React.DragEvent, task: KanbanTask) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    setDragging(task.id);
  };
  const handleDragEnd = () => setDragging(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, action: "start" | "complete" | "block" | "skip") => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    callTaskAction(taskId, action);
    setDragging(null);
  };

  if (!params.get("projectId")) {
    return (
      <Page>
        <PageHeader title="工作流看板" subtitle="项目级 Kanban 视图" />
        <Empty
          description="请通过项目详情页进入:在工作流区段右上角点「看板视图」"
          style={{ marginTop: 40 }}
        />
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader title="加载中..." />
        <Skeleton active />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={() => router.back()}
        title={`${data.projectName} · 看板`}
        subtitle={`${data.projectNo} · ${data.totals.total} 任务 · ${data.totals.pending} 待开始 / ${data.totals.inProgress} 进行中 / ${data.totals.completed} 已完成`}
        meta={
          <Space>
            {data.totals.blocked > 0 && <Tag color="error">{data.totals.blocked} 阻塞</Tag>}
          </Space>
        }
      />

      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 16,
          minHeight: "calc(100vh - 200px)",
          flexWrap: isMobile ? "wrap" : "nowrap"
        }}
      >
        {data.columns.map((col) => {
          const isLocked = col.phaseState === "LOCKED";
          const droppableTasks = col.tasks.filter(
            (t) => t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED"
          );
          const hasPending = col.tasks.some((t) => t.status === "PENDING" || t.status === "BLOCKED");
          const hasInProgress = col.tasks.some((t) => t.status === "IN_PROGRESS");

          const sorted = [...col.tasks].sort(
            (a, b) => (WORKFLOW_TASK_STATUS_SORT[a.status] ?? 9) - (WORKFLOW_TASK_STATUS_SORT[b.status] ?? 9)
          );

          return (
            <div
              key={col.phase}
              style={{
                flex: isMobile ? "1 1 100%" : "0 0 240px",
                minWidth: 220,
                background: isLocked ? "#f5f5f5" : "#fafafa",
                borderRadius: 8,
                border: `1px solid ${isLocked ? "#e8e8e8" : "#f0f0f0"}`,
                opacity: isLocked ? 0.6 : 1
              }}
            >
              <div style={{ padding: "10px 12px 6px" }}>
                <Space size={6}>
                  {isLocked ? <LockOutlined style={{ color: "#999", fontSize: 12 }} /> : null}
                  <Text strong style={{ fontSize: 13 }}>
                    {WORKFLOW_PHASE_MAP[col.phase] ?? col.name}
                  </Text>
                  <Tag color={WORKFLOW_PHASE_STATE_TONE[col.phaseState]} style={{ fontSize: 10, margin: 0 }}>
                    {WORKFLOW_PHASE_STATE_LABEL[col.phaseState]}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {col.byStatus.COMPLETED + col.byStatus.SKIPPED}/{col.total}
                  </Text>
                </Space>
              </div>

              <div style={{ display: "flex", gap: 2, padding: "0 12px 6px", flexWrap: "wrap" }}>
                {(["PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "SKIPPED"] as const).map((s) => {
                  const cnt = col.byStatus[s];
                  if (cnt === 0) return null;
                  return (
                    <Tag
                      key={s}
                      color={WORKFLOW_TASK_STATUS_TONE[s]}
                      style={{ margin: 0, fontSize: 10, padding: "0 4px", lineHeight: "18px" }}
                    >
                      {WORKFLOW_TASK_STATUS_MAP[s]} {cnt}
                    </Tag>
                  );
                })}
              </div>

              <Space
                orientation="vertical"
                size={4}
                style={{ display: "flex", padding: "0 8px" }}
              >
                {sorted.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12, textAlign: "center", padding: 12, display: "block" }}>
                    无任务
                  </Text>
                ) : (
                  sorted.map((t) => {
                    const canDrag = !isMobile && !isLocked && (t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED");
                    return (
                      <div
                        key={t.id}
                        draggable={canDrag}
                        onDragStart={(e) => handleDragStart(e, t)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setDrawerTask(t)}
                        style={{
                          background: "#fff",
                          border: "1px solid #f0f0f0",
                          borderRadius: 4,
                          padding: 8,
                          cursor: canDrag ? "grab" : "pointer",
                          opacity: dragging === t.id ? 0.4 : 1,
                          transition: "opacity 0.15s",
                          position: "relative"
                        }}
                      >
                        <Space size={4} wrap style={{ marginBottom: 4 }}>
                          <Tag color={WORKFLOW_TASK_STATUS_TONE[t.status]} style={{ margin: 0, fontSize: 11 }}>
                            {WORKFLOW_TASK_STATUS_MAP[t.status]}
                          </Tag>
                          {t.requiresTwoStepReview && (
                            <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>二审</Tag>
                          )}
                          {t.reviewStatus && (
                            <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>{t.reviewStatus}</Tag>
                          )}
                        </Space>
                        <Tooltip title={t.name}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.name}
                          </div>
                        </Tooltip>
                        {t.assigneeId && (
                          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{t.assigneeId.slice(0, 6)}</div>
                        )}
                        {/* 快捷操作下拉菜单 */}
                        {!isLocked && (
                          <div
                            style={{ position: "absolute", right: 4, top: 4, opacity: 0.7 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Dropdown
                              menu={{
                                items: [
                                  t.status === "PENDING" || t.status === "BLOCKED"
                                    ? { key: "start", icon: <PlayCircleOutlined />, label: "开始", onClick: () => callTaskAction(t.id, "start") }
                                    : null,
                                  t.status === "IN_PROGRESS"
                                    ? { key: "complete", icon: <CheckCircleOutlined />, label: "完成", onClick: () => callTaskAction(t.id, "complete") }
                                    : null,
                                  t.status === "PENDING" || t.status === "IN_PROGRESS"
                                    ? { key: "block", icon: <StopOutlined />, label: "阻塞", onClick: () => callTaskAction(t.id, "block") }
                                    : null,
                                  t.status === "BLOCKED"
                                    ? { key: "unblock", icon: <UndoOutlined />, label: "解除阻塞", onClick: () => callTaskAction(t.id, "unblock") }
                                    : null,
                                  t.status === "PENDING" || t.status === "BLOCKED"
                                    ? { key: "skip", icon: <ForwardOutlined />, label: "跳过", danger: true, onClick: () => callTaskAction(t.id, "skip") }
                                    : null
                                ].filter(Boolean) as never
                              }}
                              trigger={["click"]}
                            >
                              <Button
                                size="small"
                                type="text"
                                icon={<MoreOutlined />}
                                style={{ fontSize: 12, height: 20, minWidth: 20, padding: 0 }}
                              />
                            </Dropdown>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </Space>

              {/* 拖放操作区 */}
              {!isLocked && droppableTasks.length > 0 && (
                <div style={{ padding: "6px 8px 8px", display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {hasPending && (
                    <div
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, "start")}
                      style={{
                        flex: "1 1 auto",
                        border: "1px dashed #1677ff",
                        borderRadius: 4,
                        padding: "4px 6px",
                        textAlign: "center",
                        fontSize: 11,
                        color: "#1677ff",
                        background: "#e6f4ff",
                        cursor: "default",
                        transition: "background 0.15s"
                      }}
                      onDragEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#bae0ff";
                      }}
                      onDragLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#e6f4ff";
                      }}
                    >
                      <PlayCircleOutlined /> 开始
                    </div>
                  )}
                  {hasInProgress && (
                    <div
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, "complete")}
                      style={{
                        flex: "1 1 auto",
                        border: "1px dashed #52c41a",
                        borderRadius: 4,
                        padding: "4px 6px",
                        textAlign: "center",
                        fontSize: 11,
                        color: "#52c41a",
                        background: "#f6ffed",
                        cursor: "default",
                        transition: "background 0.15s"
                      }}
                      onDragEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#d9f7be";
                      }}
                      onDragLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#f6ffed";
                      }}
                    >
                      <CheckCircleOutlined /> 完成
                    </div>
                  )}
                  {hasPending && (
                    <div
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, "skip")}
                      style={{
                        flex: "1 1 auto",
                        border: "1px dashed #faad14",
                        borderRadius: 4,
                        padding: "4px 6px",
                        textAlign: "center",
                        fontSize: 11,
                        color: "#faad14",
                        background: "#fffbe6",
                        cursor: "default",
                        transition: "background 0.15s"
                      }}
                      onDragEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#fff1b8";
                      }}
                      onDragLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#fffbe6";
                      }}
                    >
                      <ForwardOutlined /> 跳过
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <TaskDrawer
        task={drawerTask as never}
        open={!!drawerTask}
        onClose={() => setDrawerTask(null)}
        onChanged={() => { mutate(); setDrawerTask(null); }}
        canEdit={true}
      />
    </Page>
  );
}
