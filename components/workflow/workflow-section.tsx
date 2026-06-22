"use client";
// 项目详情页 - 工作流区段(P1)
// - 调 GET /api/projects/[id]/workflow 拉取按阶段聚合的任务实例
// - 0 实例时显示空态 + 「初始化工作流」按钮(POST /api/projects/[id]/workflow/init)
// - 任务卡只显示身份信息(状态 / 任务名 / 属性 Tag);状态机操作统一收进任务详情抽屉

import useSWR from "swr";
import { useEffect, useState } from "react";
import { App as AntdApp, Badge, Button, Collapse, Empty, Space, Spin, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
  PlayCircleOutlined,
  StopOutlined
} from "@ant-design/icons";
import { TaskDrawer } from "./task-drawer";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  SERVICE_TYPE_MAP
} from "@/lib/enum-maps";
import { useRoleNameMap } from "@/lib/role-lookup";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type TaskInstance = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort: number;
  requiredRole: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  assigneeId: string | null;
  completedAt: string | null;
  completedById: string | null;
  remark: string | null;
  phase: string;
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
  const { data, isLoading, error, mutate } = useSWR<WorkflowDto>(`/api/projects/${projectId}/workflow`);
  const { isMobile } = useResponsive();
  const [initing, setIniting] = useState(false);

  // 抽屉打开期间,SWR 重新拉取后把最新任务同步回 drawerTask,让操作按钮立即反映新状态
  // 依赖项只放 data: 仅在服务端数据刷新时同步,避免 drawerTask 自更新导致循环
  useEffect(() => {
    if (!drawerTask || !data) return;
    for (const stage of data.stages) {
      const updated = stage.tasks.find((x) => x.id === drawerTask.id);
      if (updated) {
        setDrawerTask(updated);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <Empty
        description={`加载失败:${(error as Error).message}`}
      >
        <Button onClick={() => mutate()}>重试</Button>
      </Empty>
    );
  }

  if (!data || data.totals.total === 0) {
    return (
      <Empty
        description={
          data?.serviceType
            ? `服务类型 ${SERVICE_TYPE_MAP[data.serviceType] ?? data.serviceType} 尚未生成工作流实例`
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
                phaseState={ps?.state}
                lockReason={ps?.lockReason}
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
  phaseState,
  lockReason
}: {
  task: TaskInstance;
  phaseState?: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  lockReason?: string;
}) {
  const roleNameMap = useRoleNameMap();
  // 任务卡只展示身份信息;状态机按钮、审阅进度、备注、活动历史都在抽屉里
  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        padding: 12,
        background: "#fafafa"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {phaseState === "LOCKED" && (
          <Tooltip title={lockReason ?? "前一阶段未完成"}>
            <Tag color="default" icon={<LockOutlined />}>未解锁</Tag>
          </Tooltip>
        )}
        <Tag color={STATUS_TONE[task.status]} icon={STATUS_ICON[task.status]}>
          {WORKFLOW_TASK_STATUS_MAP[task.status]}
        </Tag>
        <Text strong>{task.name}</Text>
        {task.requiredRole && <Tag>{roleNameMap[task.requiredRole] ?? task.requiredRole}</Tag>}
      </div>
      {task.description && (
        <Text
          type="secondary"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginTop: 6,
            fontSize: 12
          }}
        >
          {task.description}
        </Text>
      )}
    </div>
  );
}

