"use client";
// P9+P14: 工作流 Kanban 视图 — 5 列按阶段展示任务身份信息;活动历史不在此页,改去项目详情页
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  WORKFLOW_TASK_STATUS_TONE,
  WORKFLOW_PHASE_STATE_LABEL,
  WORKFLOW_PHASE_STATE_TONE,
  WORKFLOW_TASK_STATUS_SORT,
  WORKFLOW_REVIEW_STATUS_MAP
} from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type KanbanTask = {
  id: string;
  name: string;
  code: string;
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
  const projectId = params.get("projectId") ?? "";
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data, isLoading } = useSWR<Kanban>(
    params.get("projectId") ? `/api/projects/${params.get("projectId")}/workflow/board` : null
  );
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
                style={{ display: "flex", padding: "0 8px 8px" }}
              >
                {sorted.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12, textAlign: "center", padding: 12, display: "block" }}>
                    无任务
                  </Text>
                ) : (
                  sorted.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        background: "#fff",
                        border: "1px solid #f0f0f0",
                        borderRadius: 4,
                        padding: 8
                      }}
                    >
                      <Space size={4} wrap style={{ marginBottom: 4 }}>
                        <Tag color={WORKFLOW_TASK_STATUS_TONE[t.status]} style={{ margin: 0, fontSize: 11 }}>
                          {WORKFLOW_TASK_STATUS_MAP[t.status]}
                        </Tag>
                        {t.code && <Tag style={{ margin: 0, fontSize: 11 }}>{t.code}</Tag>}
                        {t.requiresTwoStepReview && (
                          <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>二审</Tag>
                        )}
                        {t.reviewStatus && (
                          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>{WORKFLOW_REVIEW_STATUS_MAP[t.reviewStatus] ?? t.reviewStatus}</Tag>
                        )}
                      </Space>
                      <Tooltip title={t.name}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </div>
                      </Tooltip>
                    </div>
                  ))
                )}
              </Space>
            </div>
          );
        })}
      </div>

    </Page>
  );
}

