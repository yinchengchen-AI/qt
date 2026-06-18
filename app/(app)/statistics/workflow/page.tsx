"use client";
// P3: 工作流统计页 — 管理员的全局视角
// - KPI: 进行中项目/活跃任务/阻塞/审阅中/超期
// - 状态分布柱状图 + 服务类型分布柱状图
// - 超期任务清单
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Alert, Card, Col, Empty, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from "antd";
import { ClockCircleOutlined, ExclamationCircleOutlined, PlayCircleOutlined, ProjectOutlined, StopOutlined } from "@ant-design/icons";
import { Column } from "@ant-design/charts";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";
import { WORKFLOW_PHASE_MAP, WORKFLOW_TASK_STATUS_MAP, SERVICE_TYPE_MAP, WORKFLOW_REVIEW_STATUS_MAP } from "@/lib/enum-maps";

const { Text } = Typography;

type Overview = {
  totals: { projects: number; activeTasks: number; blockedTasks: number; inReview: number; overdue: number };
  byStatus: { status: string; count: number }[];
  byServiceType: { serviceType: string; activeTasks: number; projects: number }[];
};

type OverdueItem = {
  id: string;
  taskName: string;
  projectId: string;
  projectNo: string;
  projectName: string;
  phase: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  reviewStatus: string | null;
  startedAt: string;
  estimateDays: number;
  elapsedDays: number;
  overdueDays: number;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  SKIPPED: "warning",
  BLOCKED: "error"
};

export default function WorkflowStatsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data: ov, isLoading: ovLoading, error: ovError } = useSWR<Overview>("/api/workflow/overview");
  const { data: od, isLoading: odLoading } = useSWR<{ total: number; items: OverdueItem[] }>("/api/workflow/overdue?limit=20");

  if (ovError) {
    return (
      <Page>
        <PageHeader title="工作流概览" subtitle="全局进行中工作流统计" />
        <Alert
          type="error"
          showIcon
          title="无法加载工作流概览"
          description="该页面对管理员可见。请确认您已登录管理员账号。"
        />
      </Page>
    );
  }

  if (ovLoading || !ov) {
    return (
      <Page>
        <PageHeader title="工作流概览" subtitle="全局进行中工作流统计" />
        <Skeleton active paragraph={{ rows: 6 }} />
      </Page>
    );
  }

  const t = ov.totals;
  const chartHeight = isMobile ? 220 : 320;

  return (
    <Page>
      <PageHeader title="工作流概览" subtitle="管理员视角:全局阶段分布、超期风险" />

      {/* KPI 区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="进行中项目"
              value={t.projects}
              suffix="个"
              prefix={<ProjectOutlined style={{ color: "#1677ff" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="活跃任务"
              value={t.activeTasks}
              suffix="项"
              prefix={<PlayCircleOutlined style={{ color: "#52c41a" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="阻塞"
              value={t.blockedTasks}
              suffix="项"
              prefix={<StopOutlined style={{ color: "#ff4d4f" }} />}
              styles={{ content: { color: t.blockedTasks > 0 ? "#ff4d4f" : undefined } }}
            />
          </Card>
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="审阅中"
              value={t.inReview}
              suffix="项"
              prefix={<ClockCircleOutlined style={{ color: "#722ed1" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="超期"
              value={t.overdue}
              suffix="项"
              prefix={<ExclamationCircleOutlined style={{ color: "#fa8c16" }} />}
              styles={{ content: { color: t.overdue > 0 ? "#fa8c16" : undefined } }}
            />
          </Card>
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Card>
            <Statistic
              title="完成率"
              value={t.activeTasks === 0 ? 100 : Math.round((ov.byStatus.find((b) => b.status === "COMPLETED")?.count ?? 0) / (t.activeTasks + (ov.byStatus.find((b) => b.status === "COMPLETED")?.count ?? 0)) * 100)}
              suffix="%"
              prefix={<ProjectOutlined style={{ color: "#13c2c2" }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* 图表区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="任务状态分布">
            {ov.byStatus.length > 0 ? (
              <Column
                data={ov.byStatus.map((s) => ({
                  status: WORKFLOW_TASK_STATUS_MAP[s.status] ?? s.status,
                  count: s.count
                }))}
                xField="status"
                yField="count"
                height={chartHeight}
                autoFit
                colorField="status"
                label={{ text: (d: Record<string, unknown>) => String(d.count), position: "top" }}
              />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="按服务类型分布(活跃任务)">
            {ov.byServiceType.length > 0 ? (
              <Column
                data={ov.byServiceType.map((s) => ({
                  serviceType: SERVICE_TYPE_MAP[s.serviceType] ?? s.serviceType,
                  activeTasks: s.activeTasks,
                  projects: s.projects
                }))}
                xField="serviceType"
                yField="activeTasks"
                height={chartHeight}
                autoFit
                colorField="serviceType"
                label={{ text: (d: Record<string, unknown>) => String(d.activeTasks), position: "top" }}
              />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 超期任务清单 */}
      <Card title={<Space><ExclamationCircleOutlined style={{ color: "#fa8c16" }} /> 超期任务清单</Space>} style={{ marginBottom: 24 }}>
        {odLoading ? (
          <Skeleton active />
        ) : !od || od.items.length === 0 ? (
          <Empty description="当前无超期任务 🎉" />
        ) : (
          <Table<OverdueItem>
            rowKey="id"
            dataSource={od.items}
            size="small"
            pagination={false}
            columns={[
              {
                title: "超期",
                dataIndex: "overdueDays",
                width: 90,
                render: (v: number) => (
                  <Tag color={v > 14 ? "red" : v > 7 ? "orange" : "gold"}>
                    {v} 天
                  </Tag>
                ),
                sorter: (a, b) => a.overdueDays - b.overdueDays
              },
              {
                title: "任务",
                dataIndex: "taskName",
                render: (v: string, r) => (
                  <Space orientation="vertical" size={2}>
                    <Text strong>{v}</Text>
                    <Space size={4}>
                      <Tag>{WORKFLOW_PHASE_MAP[r.phase] ?? r.phase}</Tag>
                      <Tag color={STATUS_TONE[r.status]}>
                        {WORKFLOW_TASK_STATUS_MAP[r.status] ?? r.status}
                      </Tag>
                      {r.reviewStatus && <Tag color="purple">{WORKFLOW_REVIEW_STATUS_MAP[r.reviewStatus] ?? r.reviewStatus}</Tag>}
                    </Space>
                  </Space>
                )
              },
              {
                title: "项目",
                dataIndex: "projectName",
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
                title: "负责人",
                dataIndex: "assigneeName",
                width: 120,
                render: (v: string | null) => v ?? <Text type="secondary">未指派</Text>
              },
              {
                title: "已耗时 / 预估",
                width: 140,
                render: (_, r) => (
                  <Text type={r.elapsedDays > r.estimateDays ? "danger" : undefined}>
                    {r.elapsedDays} / {r.estimateDays} 天
                  </Text>
                )
              }
            ]}
          />
        )}
      </Card>
    </Page>
  );
}
