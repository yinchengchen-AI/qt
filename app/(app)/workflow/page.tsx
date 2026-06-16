"use client";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { Button, Empty, Segmented, Space, Table, Tag, Typography } from "antd";
import {
  CheckCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined
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
  const [filter, setFilter] = useState<string>("ACTIVE");
  const [drawerTask, setDrawerTask] = useState<MyTask | null>(null);
  const statuses = filter === "ACTIVE" ? "PENDING,IN_PROGRESS,BLOCKED" : "COMPLETED,SKIPPED";
  const { data, isLoading, mutate } = useSWR<{ total: number; items: MyTask[] }>(
    `/api/workflow/my-tasks?statuses=${statuses}&limit=100`
  );

  // 抽屉打开期间,SWR 重新拉取后把 status/reviewStatus/completedAt 同步回 drawerTask,让按钮立即反映新状态
  // 依赖项只放 data: 仅在服务端数据刷新时同步,避免 drawerTask 自更新导致循环
  useEffect(() => {
    if (!drawerTask || !data) return;
    const updated = data.items.find((x) => x.id === drawerTask.id);
    if (updated && (
      updated.status !== drawerTask.status ||
      updated.reviewStatus !== drawerTask.reviewStatus ||
      updated.completedAt !== drawerTask.completedAt
    )) {
      setDrawerTask({ ...drawerTask, status: updated.status, reviewStatus: updated.reviewStatus, completedAt: updated.completedAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
        <Table<MyTask>
          rowKey="id"
          dataSource={data.items}
          pagination={{ defaultPageSize: 20, size: isMobile ? "small" : "middle" }}
          size={isMobile ? "small" : "middle"}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (v: string, r) => (
                <Space orientation="vertical" size={2}>
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
                <Space orientation="vertical" size={2}>
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
                  <Space orientation="vertical" size={2}>
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
              title: "项目",
              dataIndex: "projectId",
              width: 120,
              render: (_: unknown, r) => (
                <Button size="small" onClick={() => router.push(`/projects/${r.projectId}`)}>
                  打开项目
                </Button>
              )
            }
          ]}
        />
      )}

      <TaskDrawer task={drawerTask} open={!!drawerTask} onClose={() => setDrawerTask(null)} onChanged={() => mutate()} canEdit={true} />
    </Page>
  );
}
