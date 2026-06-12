"use client";
// 项目详情页 - 工作流区段(P1)
// - 调 GET /api/projects/[id]/workflow 拉取按阶段聚合的任务实例
// - 0 实例时显示空态 + 「初始化工作流」按钮(POST /api/projects/[id]/workflow/init)
// - 每条任务卡:状态 / 指派人 / 周期(循环任务) / 操作(start/complete/block/skip + 二审)
// - 操作走单独 fetch(状态机 / 二审 / 指派),不走 useActionCall 因为 action 路径分散

import useSWR from "swr";
import { useState } from "react";
import { App as AntdApp, Badge, Button, Collapse, Empty, Modal, Space, Spin, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  LockOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UserOutlined
} from "@ant-design/icons";
import { TaskDrawer } from "./task-drawer";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  WORKFLOW_REVIEW_STATUS_MAP,
  WORKFLOW_RECURRENCE_UNIT_MAP,
  WORKFLOW_REQUIRED_ROLE_MAP
} from "@/lib/enum-maps";
import { useUserName } from "@/lib/user-lookup";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type TaskInstance = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort: number;
  requiredRole: string | null;
  requiresDeliverable: boolean;
  requiresOnsite: boolean;
  requiresTwoStepReview: boolean;
  isRecurring: boolean;
  recurrenceUnit: string | null;
  recurrenceInterval: number | null;
  estimateDays: number | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  assigneeId: string | null;
  reviewStatus: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  completedById: string | null;
  remark: string | null;
  parentInstanceId: string | null;
  phase: string;
  attachments: unknown;
  projectId: string;
  projectNo: string;
  projectName: string;
};

type Stage = {
  phase: string;
  code: string;
  name: string;
  sort: number;
  description: string | null;
  tasks: TaskInstance[];
};

type PhaseState = {
  phase: string;
  state: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  completed: number;
  total: number;
  lockReason?: string;
};

type WorkflowDto = {
  templateId: string | null;
  templateName: string | null;
  serviceType: string | null;
  stages: Stage[];
  totals: { total: number; pending: number; inProgress: number; completed: number; skipped: number; blocked: number };
  phaseStates: PhaseState[];
};

const STATUS_TONE: Record<string, string> = {
  PENDING:     "default",
  IN_PROGRESS: "processing",
  COMPLETED:   "success",
  SKIPPED:     "warning",
  BLOCKED:     "error"
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING:     <ClockCircleOutlined />,
  IN_PROGRESS: <PlayCircleOutlined />,
  COMPLETED:   <CheckCircleOutlined />,
  SKIPPED:     <StopOutlined />,
  BLOCKED:     <ExclamationCircleOutlined />
};

export function WorkflowSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [drawerTask, setDrawerTask] = useState<TaskInstance | null>(null);
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<WorkflowDto>(`/api/projects/${projectId}/workflow`);
  const { isMobile } = useResponsive();
  const [initing, setIniting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const handleInit = async () => {
    setIniting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/workflow/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force: false })
      });
      const j = await r.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      message.success(`已生成 ${j.data.created} 个任务实例`);
      await mutate();
    } finally {
      setIniting(false);
    }
  };

  const callTask = async (taskId: string, path: string, body: unknown = {}) => {
    setBusy(taskId + path);
    try {
      const r = await fetch(`/api/workflow-tasks/${taskId}${path}`, {
        method: path === "assign" || path === "remark" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  if (!data || data.totals.total === 0) {
    return (
      <Empty
        description={
          data?.serviceType
            ? `服务类型 ${data.serviceType} 尚未生成工作流实例`
            : "该项目尚未生成工作流实例"
        }
      >
        {canEdit && data?.serviceType && (
          <Button type="primary" loading={initing} onClick={handleInit}>
            初始化工作流
          </Button>
        )}
      </Empty>
    );
  }

  const { totals, templateName, stages, phaseStates } = data;
  const phaseStateTone: Record<string, string> = { DONE: "success", PARTIAL: "processing", LOCKED: "default", READY: "default" };
  const collapseItems = stages.map((s) => ({
    key: s.code,
    label: (
      <Space>
        <Text strong>{WORKFLOW_PHASE_MAP[s.phase] ?? s.name}</Text>
        <Tag>{s.tasks.length} 任务</Tag>
        {s.tasks.some((t) => t.status === "IN_PROGRESS") && <Badge status="processing" text="进行中" />}
        {s.tasks.every((t) => t.status === "COMPLETED" || t.status === "SKIPPED") && s.tasks.length > 0 && (
          <Badge status="success" text="已完成" />
        )}
      </Space>
    ),
    children: (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {s.tasks.map((t) => {
          const ps = phaseStates?.find((x) => x.phase === t.phase);
          return (
            <div key={t.id} onClick={() => setDrawerTask(t)} style={{ cursor: "pointer" }}>
              <TaskCard
                task={t}
                canEdit={canEdit}
                busy={busy === t.id}
                phaseState={ps?.state}
                lockReason={ps?.lockReason}
                onAction={(action, body) => callTask(t.id, action, body)}
              />
            </div>
          );
        })}
      </div>
    )
  }));

  return (
    <div>
      {phaseStates && phaseStates.length > 0 && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fafafa", borderRadius: 6 }}>
          <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>阶段进度</Text>
          <Space wrap size={[8, 8]}>
            {phaseStates.map((ps) => {
              const pct = ps.total === 0 ? 0 : Math.round((ps.completed / ps.total) * 100);
              return (
                <Tooltip key={ps.phase} title={ps.lockReason ?? `${ps.completed}/${ps.total} 任务`}>
                  <Tag color={phaseStateTone[ps.state]} style={{ padding: "4px 8px" }}>
                    {WORKFLOW_PHASE_MAP[ps.phase] ?? ps.phase}
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>
                      {ps.state === "LOCKED" ? "🔒" : ps.state === "DONE" ? "✓" : `${pct}%`}
                    </span>
                  </Tag>
                </Tooltip>
              );
            })}
          </Space>
        </div>
      )}
      <Space wrap style={{ marginBottom: 12 }}>
        <Tag color="blue">模板: {templateName ?? "-"}</Tag>
        <Tag>共 {totals.total} 项</Tag>
        <Tag color="default">待开始 {totals.pending}</Tag>
        <Tag color="processing">进行中 {totals.inProgress}</Tag>
        <Tag color="success">已完成 {totals.completed}</Tag>
        {totals.blocked > 0 && <Tag color="error">阻塞 {totals.blocked}</Tag>}
        {totals.skipped > 0 && <Tag color="warning">跳过 {totals.skipped}</Tag>}
      </Space>
      <Collapse
        items={collapseItems}
        defaultActiveKey={stages[0] ? [stages[0].code] : []}
        bordered={!isMobile}
        size={isMobile ? "small" : "middle"}
      />
      <TaskDrawer task={drawerTask} open={!!drawerTask} onClose={() => setDrawerTask(null)} onChanged={() => mutate()} canEdit={canEdit} />
    </div>
  );
}


function TaskCard({
  task,
  canEdit,
  busy,
  phaseState,
  lockReason,
  onAction
}: {
  task: TaskInstance;
  canEdit: boolean;
  busy: boolean;
  phaseState?: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  lockReason?: string;
  onAction: (path: string, body?: unknown) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        padding: 12,
        background: "#fafafa"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <Space wrap>
          {phaseState === "LOCKED" && (
            <Tooltip title={lockReason ?? "前一阶段未完成"}>
              <Tag color="default" icon={<LockOutlined />}>未解锁</Tag>
            </Tooltip>
          )}
          <Tag color={STATUS_TONE[task.status]} icon={STATUS_ICON[task.status]}>
            {WORKFLOW_TASK_STATUS_MAP[task.status]}
          </Tag>
          <Text strong>{task.name}</Text>
          {task.requiredRole && <Tag>{WORKFLOW_REQUIRED_ROLE_MAP[task.requiredRole] ?? task.requiredRole}</Tag>}
          {task.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
          {task.requiresOnsite && <Tag color="gold">现场</Tag>}
          {task.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
          {task.isRecurring && (
            <Tag color="geekblue" icon={<ReloadOutlined />}>
              每 {task.recurrenceInterval ?? 1} {WORKFLOW_RECURRENCE_UNIT_MAP[task.recurrenceUnit ?? ""] ?? task.recurrenceUnit}
            </Tag>
          )}
          {task.estimateDays && <Tag>预估 {task.estimateDays} 天</Tag>}
        </Space>
        {canEdit && <TaskActions task={task} busy={busy} onAction={onAction} />}
      </div>
      {task.description && (
        <Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
          {task.description}
        </Text>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <AssigneeName id={task.assigneeId} />
        {task.reviewStatus && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            审阅: {WORKFLOW_REVIEW_STATUS_MAP[task.reviewStatus] ?? task.reviewStatus}
          </Text>
        )}
        {task.completedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            完成于: {new Date(task.completedAt).toLocaleString("zh-CN")}
          </Text>
        )}
      </div>
      {task.remark && (
        <div style={{ marginTop: 6, padding: 6, background: "#fff", borderRadius: 4, fontSize: 12, whiteSpace: "pre-wrap" }}>
          {task.remark}
        </div>
      )}
      <TaskHistory taskId={task.id} isAdmin={true} />
    </div>
  );
}

function TaskActions({
  task,
  busy,
  phaseState,
  lockReason,
  onAction
}: {
  task: TaskInstance;
  busy: boolean;
  phaseState?: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  lockReason?: string;
  onAction: (path: string, body?: unknown) => void;
}) {
  const buttons: React.ReactNode[] = [];

  // 状态机按钮
  if (task.status === "PENDING" || task.status === "BLOCKED") {
    // 阶段锁定信息通过 task.id 之外传,这里我们接受一个 disabled 标记
    // P3: 通过 props 传入 stageState 判定(简化:在 TaskCard 处判定)
    if (phaseState === "LOCKED") {
      buttons.push(
        <Tooltip key="start-locked" title={lockReason ?? "前一阶段未完成"}>
          <Button key="start" size="small" type="primary" loading={busy} disabled icon={<LockOutlined />} onClick={() => onAction("/action", { action: "start" })}>
            未解锁
          </Button>
        </Tooltip>
      );
    } else {
      buttons.push(
        <Button key="start" size="small" type="primary" loading={busy} onClick={() => onAction("/action", { action: "start" })}>
          开始
        </Button>
      );
    }
  }
  if (task.status === "IN_PROGRESS") {
    buttons.push(
      <Button key="complete" size="small" type="primary" loading={busy} onClick={() => onAction("/action", { action: "complete" })}>
        完成
      </Button>
    );
    buttons.push(
      <Button key="block" size="small" danger loading={busy} onClick={() => onAction("/action", { action: "block" })}>
        阻塞
      </Button>
    );
  }
  if (task.status === "BLOCKED") {
    buttons.push(
      <Button key="unblock" size="small" loading={busy} onClick={() => onAction("/action", { action: "unblock" })}>
        解阻
      </Button>
    );
  }
  if (task.status === "PENDING" || task.status === "BLOCKED") {
    buttons.push(
      <Button
        key="skip"
        size="small"
        onClick={() =>
          Modal.confirm({
            title: `跳过「${task.name}」?`,
            content: "跳过后该任务不再阻塞流程,也不会出现在交付清单中。",
            okText: "确认跳过",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => onAction("/action", { action: "skip" })
          })
        }
      >
        跳过
      </Button>
    );
  }

  // 二审按钮(报告类)
  if (task.requiresTwoStepReview && task.status === "IN_PROGRESS") {
    if (!task.reviewStatus || task.reviewStatus === "REJECTED") {
      buttons.push(
        <Tooltip key="review-submit" title="提交校核">
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={busy}
            onClick={() => onAction("/review", { action: "submit" })}
          >
            提交校核
          </Button>
        </Tooltip>
      );
    } else if (task.reviewStatus === "REVIEWING") {
      buttons.push(
        <Button key="review-approve" size="small" type="primary" loading={busy} onClick={() => onAction("/review", { action: "approve" })}>
          审核通过
        </Button>
      );
      buttons.push(
        <Button key="review-reject" size="small" danger loading={busy} onClick={() => onAction("/review", { action: "reject" })}>
          驳回
        </Button>
      );
    }
  }

  if (buttons.length === 0) {
    return null;
  }
  return <Space wrap size={4}>{buttons}</Space>;
}



type HistoryEntry = {
  id: string;
  action: string;
  actorId: string;
  actorName: string | null;
  at: string;
  diff: { before: unknown; after: unknown } | null;
};

const ACTION_LABEL: Record<string, string> = {
  WORKFLOW_INSTANTIATE: "模板实例化",
  WORKFLOW_TASK_START: "开始任务",
  WORKFLOW_TASK_COMPLETE: "完成任务",
  WORKFLOW_TASK_BLOCK: "阻塞任务",
  WORKFLOW_TASK_UNBLOCK: "解除阻塞",
  WORKFLOW_TASK_SKIP: "跳过任务",
  WORKFLOW_TASK_ASSIGN: "重新指派",
  WORKFLOW_TASK_REMARK: "更新备注",
  WORKFLOW_REVIEW_SUBMIT: "提交校核",
  WORKFLOW_REVIEW_APPROVE: "审核通过",
  WORKFLOW_REVIEW_REJECT: "驳回校核",
  WORKFLOW_RECURRING_GENERATE: "循环生成"
};

function TaskHistory({ taskId, isAdmin }: { taskId: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useSWR<{ items: HistoryEntry[] }>(open ? "/api/workflow-tasks/" + taskId + "/history" : null);
  if (!isAdmin) return null;
  return (
    <div style={{ marginTop: 8, borderTop: "1px dashed #f0f0f0", paddingTop: 6 }}>
      <Button size="small" type="text" icon={<HistoryOutlined />} onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "展开"}活动历史
      </Button>
      {open && (
        <div style={{ marginTop: 6, padding: 8, background: "#fff", borderRadius: 4, maxHeight: 200, overflowY: "auto" }}>
          {isLoading ? (
            <Text type="secondary" style={{ fontSize: 12 }}>加载中...</Text>
          ) : !data || data.items.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>暂无活动</Text>
          ) : (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {data.items.map((h) => (
                <div key={h.id} style={{ fontSize: 12, borderBottom: "1px solid #f5f5f5", paddingBottom: 4 }}>
                  <Space size={4} wrap>
                    <Tag color="blue" style={{ margin: 0 }}>{ACTION_LABEL[h.action] ?? h.action}</Tag>
                    <Space size={2}>
                      <UserOutlined />
                      <span>{h.actorName ?? h.actorId.slice(0, 8)}</span>
                    </Space>
                    <Space size={2}>
                      <ClockCircleOutlined />
                      <span>{new Date(h.at).toLocaleString("zh-CN")}</span>
                    </Space>
                  </Space>
                </div>
              ))}
            </Space>
          )}
        </div>
      )}
    </div>
  );
}

function AssigneeName({ id }: { id: string | null }) {
  const name = useUserName(id ?? "", "未指派");
  return (
    <Text type="secondary" style={{ fontSize: 12 }}>
      负责人: {name}
    </Text>
  );
}
