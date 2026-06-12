"use client";
// P9: 工作流 Kanban 视图 — 5 列对应 5 阶段,任务卡可点开抽屉
import useSWR from "swr";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App as AntdApp, Empty, Select, Skeleton, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
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

export default function WorkflowBoardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data, isLoading } = useSWR<Kanban>(
    params.get("projectId") ? `/api/projects/${params.get("projectId")}/workflow/board` : null
  );
  const [drawerTask, setDrawerTask] = useState<KanbanTask | null>(null);

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
        {data.columns.map((col) => (
          <div
            key={col.phase}
            style={{
              background: "#fafafa",
              borderRadius: 6,
              padding: 10,
              minWidth: isMobile ? 280 : 0,
              opacity: col.phaseState === "LOCKED" ? 0.6 : 1
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <Space size={4} wrap>
                <Text strong>{WORKFLOW_PHASE_MAP[col.phase] ?? col.name}</Text>
                <Tag color={PHASE_STATE_TONE[col.phaseState]}>{PHASE_STATE_LABEL[col.phaseState]}</Tag>
                {col.phaseState === "LOCKED" && <LockOutlined style={{ color: "#999" }} />}
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
                    onClick={() => setDrawerTask(t)}
                    style={{
                      background: "#fff",
                      border: "1px solid #f0f0f0",
                      borderRadius: 4,
                      padding: 8,
                      cursor: "pointer"
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
            </Space>
          </div>
        ))}
      </div>

      <TaskDrawer
        task={drawerTask as never}
        open={!!drawerTask}
        onClose={() => setDrawerTask(null)}
        onChanged={() => window.location.reload()}
        canEdit={true}
      />
    </Page>
  );
}
