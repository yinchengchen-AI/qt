"use client";
import useSWR from "swr";
import { useState } from "react";
import { App as AntdApp, Button, Empty, Segmented, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  WORKFLOW_REVIEW_STATUS_MAP,
  WORKFLOW_TASK_STATUS_TONE,
} from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";
import { TaskDrawer } from "@/components/workflow/task-drawer";

const { Text } = Typography;

type MyTask = {
  id: string;
  taskName: string;
  taskDescription: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  reviewStatus: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
  projectId: string;
  projectNo: string;
  projectName: string;
  phase: string;
  phaseName: string;
  requiresDeliverable: boolean;
  requiresTwoStepReview: boolean;
  isRecurring: boolean;
  estimateDays: number | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  projectStatus: string;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING:     <PlayCircleOutlined />,
  IN_PROGRESS: <PlayCircleOutlined />,
  COMPLETED:   <CheckCircleOutlined />,
  SKIPPED:     <StopOutlined />,
  BLOCKED:     <StopOutlined />
};

const FILTER_OPTIONS = [
  { label: "待办", value: "ACTIVE" },
  { label: "已完成", value: "DONE" }
];

export default function MyTasksPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { message } = AntdApp.useApp();
  const [filter, setFilter] = useState<string>("ACTIVE");
  const [drawerTask, setDrawerTask] = useState<MyTask | null>(null);
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const statuses = filter === "ACTIVE" ? "PENDING,IN_PROGRESS,BLOCKED" : "COMPLETED,SKIPPED";
  const { data, isLoading, mutate } = useSWR<{ total: number; items: MyTask[] }>(
    `/api/workflow/my-tasks?statuses=${statuses}&limit=100`
  );

  const doBatch = async (action: "start" | "complete" | "block" | "unblock" | "skip" | "assign", extra: Record<string, unknown> = {}) => {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const r = await fetch("/api/workflow-tasks/batch-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskIds: selectedIds.map(String), action, ...extra })
      });
      const j = await r.json();
      if (j.code !== 0) { message.error(j.message); return; }
      const { succeeded, failed } = j.data;
      if (failed.length > 0) {
        message.warning(`成功 ${succeeded.length} 条,失败 ${failed.length} 条(可能阶段锁定或状态不允许)`);
      } else {
        message.success(`批量操作成功:${succeeded.length} 条`);
      }
      setSelectedIds([]);
      await mutate();
    } finally {
      setBatchBusy(false);
    }
  };

  const callTask = async (taskId: string, path: string, body: unknown = {}) => {
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
    message.success("操作成功");
    await mutate();
  };

  return (
    <Page>
      <PageHeader
        title="我的工作流"
        subtitle={`${data?.total ?? 0} 项任务${filter === "ACTIVE" ? "待处理" : "已完成/跳过"}`}
        actions={
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as string)}
            options={FILTER_OPTIONS}
          />
        }
      />

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>加载中...</div>
      ) : !data || data.items.length === 0 ? (
        <Empty description={filter === "ACTIVE" ? "暂无待办任务" : "暂无完成记录"} />
      ) : (
        <>
        {selectedIds.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, background: "#e6f4ff", borderRadius: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Text>已选 <Text strong>{selectedIds.length}</Text> 项</Text>
            <Button size="small" loading={batchBusy} onClick={() => doBatch("start")}>批量开始</Button>
            <Button size="small" loading={batchBusy} onClick={() => doBatch("complete")}>批量完成</Button>
            <Button size="small" loading={batchBusy} danger onClick={() => doBatch("block")}>批量阻塞</Button>
            <Button size="small" onClick={() => setSelectedIds([])}>清空选择</Button>
          </div>
        )}
        <Table<MyTask>
          rowKey="id"
          dataSource={data.items}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys)
          }}
          pagination={{ pageSize: 20, size: isMobile ? "small" : "middle" }}
          size={isMobile ? "small" : "middle"}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (v: string, r) => (
                <Space direction="vertical" size={2}>
                  <Tag color={WORKFLOW_TASK_STATUS_TONE[v]} icon={STATUS_ICON[v]}>
                    {WORKFLOW_TASK_STATUS_MAP[v]}
                  </Tag>
                  {r.reviewStatus && (
                    <Tag color="purple">{WORKFLOW_REVIEW_STATUS_MAP[r.reviewStatus]}</Tag>
                  )}
                </Space>
              )
            },
            {
              title: "任务",
              dataIndex: "taskName",
              onCell: (r: MyTask) => ({ onClick: () => setDrawerTask(r), style: { cursor: "pointer" } }),
              render: (v: string, r) => (
                <Space direction="vertical" size={2}>
                  <Text strong>{v}</Text>
                  <Space size={4} wrap>
                    <Tag>{WORKFLOW_PHASE_MAP[r.phase] ?? r.phaseName}</Tag>
                    {r.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
                    {r.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
                    {r.isRecurring && (
                      <Tag color="geekblue" icon={<ReloadOutlined />}>
                        循环
                      </Tag>
                    )}
                    {r.estimateDays && <Tag>预估 {r.estimateDays} 天</Tag>}
                  </Space>
                </Space>
              )
            },
            {
              title: "所属项目",
              dataIndex: "projectName",
              width: 220,
              render: (v: string, r) => (
                <a onClick={() => router.push(`/projects/${r.projectId}`)} style={{ cursor: "pointer" }}>
                  <Space direction="vertical" size={2}>
                    <Text>{v}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{r.projectNo}</Text>
                  </Space>
                </a>
              )
            },
            {
              title: "更新时间",
              dataIndex: "updatedAt",
              width: 160,
              render: (v: string) => new Date(v).toLocaleString("zh-CN")
            },
            {
              title: "操作",
              dataIndex: "id",
              width: 200,
              render: (_: unknown, r) => (
                <Space wrap size={4}>
                  {r.status === "PENDING" && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => callTask(r.id, "/action", { action: "start" })}
                    >
                      开始
                    </Button>
                  )}
                  {r.status === "IN_PROGRESS" && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => callTask(r.id, "/action", { action: "complete" })}
                    >
                      完成
                    </Button>
                  )}
                  {r.status === "BLOCKED" && (
                    <Button size="small" onClick={() => callTask(r.id, "/action", { action: "unblock" })}>
                      解阻
                    </Button>
                  )}
                  {r.requiresTwoStepReview && r.status === "IN_PROGRESS" && !r.reviewStatus && (
                    <Tooltip title="提交校核">
                      <Button
                        size="small"
                        icon={<ThunderboltOutlined />}
                        onClick={() => callTask(r.id, "/review", { action: "submit" })}
                      >
                        校核
                      </Button>
                    </Tooltip>
                  )}
                  <Button size="small" onClick={() => router.push(`/projects/${r.projectId}`)}>
                    打开项目
                  </Button>
                </Space>
              )
            }
          ]}
        />
        </>
      )}

      <TaskDrawer task={drawerTask} open={!!drawerTask} onClose={() => setDrawerTask(null)} onChanged={() => mutate()} canEdit={true} />
    </Page>
  );
}
