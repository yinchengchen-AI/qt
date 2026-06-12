"use client";
// P7: 模板版本对比
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Card, Empty, Skeleton, Space, Table, Tag, Tooltip, Typography } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { WORKFLOW_PHASE_MAP } from "@/lib/enum-maps";

const { Text } = Typography;

type DiffTask = {
  status: "added" | "removed" | "modified" | "unchanged";
  before: { [k: string]: unknown } | null;
  after: Record<string, unknown> | null;
  changes: string[];
};
type DiffStage = {
  status: "added" | "removed" | "modified" | "unchanged";
  before: { [k: string]: unknown } | null;
  after: Record<string, unknown> | null;
  changes: string[];
  tasks: DiffTask[];
};
type Diff = {
  from: { id: string; name: string; version: number; serviceType: string; description?: string | null; isActive?: boolean };
  to: { id: string; name: string; version: number; serviceType: string; description?: string | null; isActive?: boolean };
  stages: DiffStage[];
  templateChanges: { field: string; before: unknown; after: unknown }[];
  totals: { added: number; removed: number; modified: number; unchanged: number };
};

const STATUS_COLOR: { [k: string]: string } = {
  added: "green",
  removed: "red",
  modified: "orange",
  unchanged: "default"
};
const STATUS_LABEL: Record<string, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "未变"
};

const FIELD_LABEL: Record<string, string> = {
  phase: "阶段",
  code: "编码",
  name: "名称",
  description: "描述",
  isRequired: "是否必填",
  requiredRole: "执行角色",
  requiresDeliverable: "需交付物",
  requiresOnsite: "现场",
  requiresTwoStepReview: "二审",
  isRecurring: "循环",
  recurrenceUnit: "循环单位",
  recurrenceInterval: "循环间隔",
  estimateDays: "预估天数"
};;

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "string" && v === "") return "—";
  return String(v);
}

export default function TemplateDiffPage() {
  const params = useSearchParams();
  const router = useRouter();
  const fromId = params.get("fromId") ?? "";
  const toId = params.get("toId") ?? "";
  const { data, isLoading, error } = useSWR<Diff>(
    fromId && toId ? `/api/admin/workflow-templates/diff?fromId=${fromId}&toId=${toId}` : null
  );

  if (!fromId || !toId) {
    return (
      <Page>
        <PageHeader title="模板对比" />
        <Empty description="需要 fromId 与 toId 查询参数" />
      </Page>
    );
  }
  if (isLoading) {
    return (
      <Page>
        <PageHeader back={() => router.back()} title="加载中..." />
        <Skeleton active />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page>
        <PageHeader back={() => router.back()} title="模板对比" />
        <Alert type="error" showIcon message="对比失败" description="请确认 fromId / toId 都存在且 serviceType 一致" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={() => router.back()}
        title="模板对比"
        subtitle={`${data.from.serviceType}: v${data.from.version} → v${data.to.version}`}
        meta={
          <Space>
            <Tag color="green" icon={<PlusOutlined />}>{data.totals.added} 新增</Tag>
            <Tag color="red" icon={<MinusOutlined />}>{data.totals.removed} 删除</Tag>
            <Tag color="orange">修改 {data.totals.modified - data.stages.filter((s) => s.status === "modified").length} 任务</Tag>
            <Tag color="purple">修改 {data.stages.filter((s) => s.status === "modified").length} 阶段</Tag>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="模板对比说明"
        description="按 code 比对 stage 和 task;added 出现在新版本,removed 出现在旧版本,modified 字段差异列在 changes 数组里。模板级(name/description/isActive/serviceType)变化列在最上面。"
      />

      {data.templateChanges && data.templateChanges.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }} title="模板级变化">
          <Table
            size="small"
            pagination={false}
            showHeader
            columns={[
              { title: "字段", dataIndex: "field", width: 120, render: (k: string) => <Text type="secondary">{FIELD_LABEL[k] ?? k}</Text> },
              { title: "旧值", dataIndex: "before", render: (v: unknown) => <Text delete>{fmt(v)}</Text> },
              { title: "新值", dataIndex: "after", render: (v: unknown) => <Text strong type="success">{fmt(v)}</Text> }
            ]}
            dataSource={data.templateChanges.map((c: { field: string; before: unknown; after: unknown }) => ({ key: c.field, ...c }))}
          />
        </Card>
      )}

      {data.stages.length === 0 ? (
        <Empty description="两个版本完全相同" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {data.stages.map((s, idx) => {
            const title: string = String(s.after?.name ?? s.before?.name ?? s.after?.code ?? s.before?.code ?? "?");
            const phase = (s.after?.phase ?? s.before?.phase) as string | undefined;
            const phaseLabel = phase ? (WORKFLOW_PHASE_MAP[phase] ?? phase) : "—";
            return (
              <Card
                key={idx}
                size="small"
                title={
                  <Space>
                    <Tag color={STATUS_COLOR[s.status]}>{STATUS_LABEL[s.status]}</Tag>
                    <Text strong>{title}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>[{phaseLabel ?? "—"}]</Text>
                    {s.changes.length > 0 && (
                      <Tooltip title={<span>{s.changes.map((c) => FIELD_LABEL[c] ?? c).join("、")}</span>}>
                        <Tag color="orange">{s.changes.length} 字段改动</Tag>
                      </Tooltip>
                    )}
                    <Tag>{s.tasks.length} 任务</Tag>
                  </Space>
                }
              >
                {s.changes.length > 0 && (
                  <div style={{ marginBottom: 8, padding: 8, background: "#fffbe6", borderRadius: 4 }}>
                    <Text type="warning" strong style={{ fontSize: 12 }}>阶段字段变化:</Text>
                    <Table
                      size="small"
                      pagination={false}
                      showHeader
                      style={{ marginTop: 4 }}
                      columns={[
                        { title: "字段", dataIndex: "field", width: 120, render: (k: string) => <Text type="secondary">{FIELD_LABEL[k] ?? k}</Text> },
                        { title: "旧值", dataIndex: "before", render: (v: unknown) => <Text delete>{fmt(v)}</Text> },
                        { title: "新值", dataIndex: "after", render: (v: unknown) => <Text strong type="success">{fmt(v)}</Text> }
                      ]}
                      dataSource={s.changes.map((c: string) => ({ key: c, field: c, before: s.before?.[c], after: s.after?.[c] }))}
                    />
                  </div>
                )}
                {s.tasks.length > 0 && (
                  <Table<DiffTask>
                    size="small"
                    pagination={false}
                    rowKey={(r) => `${r.status}-${r.before?.code ?? r.after?.code ?? Math.random()}`}
                    columns={[
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 80,
                        render: (v: string) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
                      },
                      {
                        title: "任务编码",
                        width: 140,
                        render: (_, r) => <Text code>{(r.after?.code ?? r.before?.code) as string}</Text>
                      },
                      {
                        title: "任务名称",
                        render: (_, r) => (r.after?.name ?? r.before?.name) as string
                      },
                      {
                        title: "改动字段",
                        render: (_, r) =>
                          r.changes.length === 0 ? (
                            <Text type="secondary">—</Text>
                          ) : (
                            <Space size={2} wrap>
                              {r.changes.map((c) => (
                                <Tag key={c} color="orange" style={{ fontSize: 11 }}>{FIELD_LABEL[c] ?? c}</Tag>
                              ))}
                            </Space>
                          )
                      }
                    ]}
                    dataSource={s.tasks}
                    expandable={{
                      expandedRowRender: (r) => (
                        <div style={{ padding: 8, background: "#fafafa" }}>
                          {r.changes.length > 0 ? (
                            <Table
                              size="small"
                              pagination={false}
                              showHeader
                              columns={[
                                { title: "字段", dataIndex: "field", width: 120, render: (k: string) => <Text type="secondary">{FIELD_LABEL[k] ?? k}</Text> },
                                { title: "旧值", dataIndex: "before", render: (v: unknown) => <Text delete>{fmt(v)}</Text> },
                                { title: "新值", dataIndex: "after", render: (v: unknown) => <Text strong type="success">{fmt(v)}</Text> }
                              ]}
                              dataSource={r.changes.map((c: string) => ({ key: c, field: c, before: r.before?.[c], after: r.after?.[c] }))}
                            />
                          ) : (
                            <Text type="secondary">无字段改动</Text>
                          )}
                        </div>
                      )
                    }}
                  />
                )}
              </Card>
            );
          })}
        </Space>
      )}
    </Page>
  );
}
