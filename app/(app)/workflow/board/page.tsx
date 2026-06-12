"use client";
// P9+P13: 工作流 Kanban 视图 — 5列按阶段,支持拖拽改状态
import useSWR from "swr";
import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App as AntdApp, Empty, message, Skeleton, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { LockOutlined, PlayCircleOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { TaskDrawer } from "@/components/workflow/task-drawer";
import { WORKFLOW_PHASE_MAP, WORKFLOW_TASK_STATUS_MAP } from "@/lib/enum-maps";
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

const STATUS_TONE: Record<string, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  SKIPPED: "warning",
  BLOCKED: "error"
};
const PHASE_STATE_LABEL: Record<string, string> = {
  DONE: "已完成",
  PARTIAL: "进行中",
  LOCKED: "未解锁",
  READY: "待开始"
};
const PHASE_STATE_TONE: Record<string, string> = {
  DONE: "success",
  PARTIAL: "processing",
  LOCKED: "default",
  READY: "default"
};

// 可拖拽到的目标动作
type DropAction = "start" | "complete";

export default function WorkflowBoardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data, isLoading, mutate } = useSWR<Kanban>(
    params.get("projectId") ? `/api/projects/${params.get("projectId")}/workflow/board` : null
  );
  const [drawerTask, setDrawerTask] = useState<KanbanTask | null>(null);
  const [dragging, setDragging] = useState<string | null>(null); // taskId
  const { notification } = AntdApp.useApp();

  const callTaskAction = useCallback(async (taskId: string, action: "start" | "complete") => {
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
      notification.success({ message: action === "start" ? "任务已开始" : "任务已完成", placement: "topRight" });
      mutate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "操作失败";
      notification.error({ message: msg, placement: "topRight" });
    }
  }, [mutate, notification]);

  // 原生 HTML5 DnD handlers
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

  const handleDrop = (e: React.DragEvent, action: DropAction) => {
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
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(5, minmax(0, 1fr))",
          gap: 12,
          overflowX: isMobile ? "auto" : "visible"
        }}
      >
        {data.columns.map((col) => {
          const isLocked = col.phaseState === "LOCKED";
          const droppableTasks = col.tasks.filter(
            (t) => t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED"
          );
          const hasPending = col.tasks.some((t) => t.status === "PENDING");
          const hasInProgress = col.tasks.some((t) => t.status === "IN_PROGRESS" || t.status === "BLOCKED");

          return (
            <div
              key={col.phase}
              style={{
                background: "#fafafa",
                borderRadius: 6,
                padding: 10,
                minWidth: isMobile ? 280 : 0,
                opacity: isLocked ? 0.6 : 1
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <Space size={4} wrap>
                  <Text strong>{WORKFLOW_PHASE_MAP[col.phase] ?? col.name}</Text>
                  <Tag color={PHASE_STATE_TONE[col.phaseState]}>{PHASE_STATE_LABEL[col.phaseState]}</Tag>
                  {isLocked && <LockOutlined style={{ color: "#999" }} />}
                </Space>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  {col.total} 任务 · 进行 {col.byStatus.IN_PROGRESS} / 待 {col.byStatus.PENDING}
                </div>
              </div>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                {col.tasks.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>无任务</Text>
                ) : (
                  col.tasks.map((t) => (
                    <div
                      key={t.id}
                      draggable={!isLocked && (t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED")}
                      onDragStart={(e) => handleDragStart(e, t)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setDrawerTask(t)}
                      style={{
                        background: "#fff",
                        border: "1px solid #f0f0f0",
                        borderRadius: 4,
                        padding: 8,
                        cursor: (t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED") ? "grab" : "pointer",
                        opacity: dragging === t.id ? 0.4 : 1,
                        transition: "opacity 0.15s"
                      }}
                    >
                      <Space size={4} wrap style={{ marginBottom: 4 }}>
                        <Tag color={STATUS_TONE[t.status]} style={{ margin: 0, fontSize: 11 }}>
                          {WORKFLOW_TASK_STATUS_MAP[t.status]}
                        </Tag>
                        {t.requiresTwoStepReview && <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>二审</Tag>}
                        {t.reviewStatus && <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>{t.reviewStatus}</Tag>}
                      </Space>
                      <Tooltip title={t.name}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </div>
                      </Tooltip>
                      {t.assigneeId && (
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>👤 {t.assigneeId.slice(0, 6)}</div>
                      )}
                    </div>
                  ))
                )}
                {/* 快速操作拖放区 */}
                {!isLocked && droppableTasks.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                    {hasPending && (
                      <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, "start")}
                        style={{
                          flex: 1,
                          border: "1px dashed #1677ff",
                          borderRadius: 4,
                          padding: "6px 8px",
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
                        <PlayCircleOutlined /> 拖到此处 → 开始
                      </div>
                    )}
                    {hasInProgress && (
                      <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, "complete")}
                        style={{
                          flex: 1,
                          border: "1px dashed #52c41a",
                          borderRadius: 4,
                          padding: "6px 8px",
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
                        <CheckCircleOutlined /> 拖到此处 → 完成
                      </div>
                    )}
                  </div>
                )}
              </Space>
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
