"use client";
// Dashboard 顶部的「待办任务」小卡
// 复用 /api/workflow/my-tasks 数据,与 /workflow 页保持一致
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Button, Empty, Skeleton, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { ProCard } from "@ant-design/pro-components";
import { WORKFLOW_PHASE_MAP, WORKFLOW_TASK_STATUS_MAP } from "@/lib/enum-maps";

const { Text } = Typography;

type MyTask = {
  id: string;
  taskName: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  projectId: string;
  projectNo: string;
  projectName: string;
  phase: string;
  updatedAt: string;
};

const STATUS_TONE: Record<string, string> = {
  PENDING:     "default",
  IN_PROGRESS: "processing",
  COMPLETED:   "success",
  SKIPPED:     "warning",
  BLOCKED:     "error"
};

export function MyTasksWidget() {
  const router = useRouter();
  const { data, isLoading } = useSWR<{ total: number; items: MyTask[] }>(
    "/api/workflow/my-tasks?statuses=PENDING,IN_PROGRESS,BLOCKED&limit=5"
  );

  if (isLoading) {
    return (
      <ProCard title={<Space><PlayCircleOutlined /> 我的待办任务</Space>} style={{ marginBottom: 24 }}>
        <Skeleton active />
      </ProCard>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <ProCard
      title={
        <Space>
          <PlayCircleOutlined />
          <span>我的待办任务</span>
          {total > 0 && <Tag color="processing">{total}</Tag>}
        </Space>
      }
      extra={
        <Button type="link" onClick={() => router.push("/workflow")}>
          查看全部 <ArrowRightOutlined />
        </Button>
      }
      style={{ marginBottom: 24 }}
    >
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办,可以去喝杯咖啡 ☕" />
      ) : (
        <Space orientation="vertical" style={{ width: "100%" }} size={8}>
          {items.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "#fafafa",
                borderRadius: 6,
                cursor: "pointer"
              }}
              onClick={() => router.push(`/projects/${t.projectId}`)}
            >
              <Tag color={STATUS_TONE[t.status]} style={{ margin: 0 }}>
                {WORKFLOW_TASK_STATUS_MAP[t.status]}
              </Tag>
              <Text strong style={{ flex: 1, minWidth: 0 }} ellipsis>
                {t.taskName}
              </Text>
              <div style={{ textAlign: "right", flexShrink: 0, maxWidth: 200, lineHeight: 1.4 }}>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {WORKFLOW_PHASE_MAP[t.phase] ?? t.phase}
                </div>
                <div
                  style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={`${t.projectName} (${t.projectNo})`}
                >
                  {t.projectName}
                </div>
              </div>
            </div>
          ))}
        </Space>
      )}
    </ProCard>
  );
}
