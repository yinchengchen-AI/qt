
"use client";
// AI 用量统计 (仅 ADMIN)
//   - 顶部汇总卡: 总调用 / 缓存命中率 / token 合计 / 估算成本 (USD) / 失败数 / 平均耗时,
//     与当前过滤条件同口径 (后端同一 where 计算)
//   - 表格: feature / 状态 / 是否命中缓存 / 操作人(姓名/工号) / 时间范围 过滤, 默认时间倒序
import { useMemo, useState } from "react";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Card, Col, Row, Statistic, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
import { PageHeader } from "@/components/page-header";
import { DateTimeCell } from "@/components/table-cells";

type Row = {
  id: string;
  feature: string;
  userId: string;
  userName: string;
  userEmployeeNo: string;
  model: string;
  cacheHit: boolean;
  promptTokens: number;
  completionTokens: number;
  costEstimate: number | null;
  latencyMs: number;
  status: "SUCCESS" | "FAILURE";
  errorMessage: string | null;
  requestId: string | null;
  createdAt: string;
};

type Summary = {
  totalCalls: number;
  cacheHitCount: number;
  cacheHitRate: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  costEstimate: number;
  avgLatencyMs: number;
};

const EMPTY_SUMMARY: Summary = {
  totalCalls: 0,
  cacheHitCount: 0,
  cacheHitRate: 0,
  failureCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  costEstimate: 0,
  avgLatencyMs: 0,
};

// feature 列的可读名; 新 feature 接入 ai-client 时同步补一行
const FEATURE_LABELS: Record<string, string> = {
  CONTRACT_RISK_ANALYSIS: "合同风险分析",
};
const FEATURE_OPTIONS = Object.entries(FEATURE_LABELS).map(([value, label]) => ({ value, label }));

// 时间范围 RangePicker 预设 (与操作日志页同一组)
function buildTimeRangePresets(): { label: string; value: () => [dayjs.Dayjs, dayjs.Dayjs] }[] {
  return [
    { label: "近 24 小时", value: () => [dayjs().subtract(24, "hour"), dayjs()] },
    { label: "今天", value: () => [dayjs().startOf("day"), dayjs().endOf("day")] },
    {
      label: "近 7 天",
      value: () => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")],
    },
    {
      label: "近 30 天",
      value: () => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")],
    },
    { label: "本月", value: () => [dayjs().startOf("month"), dayjs().endOf("day")] },
  ];
}

// dayjs / ISO 字符串统一转 ISO;非法值回退 undefined
function toIso(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const d = dayjs.isDayjs(v) ? v : dayjs(v as string);
  return d.isValid() ? d.toISOString() : undefined;
}

function buildQuery(values: Record<string, unknown>, page: number, pageSize: number) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  if (values.feature) qs.set("feature", String(values.feature));
  if (values.status) qs.set("status", String(values.status));
  if (values.cacheHit !== undefined && values.cacheHit !== null && values.cacheHit !== "") {
    qs.set("cacheHit", String(values.cacheHit));
  }
  if (values.userKeyword) qs.set("userKeyword", String(values.userKeyword));
  const range = Array.isArray(values.createdAtRange) ? (values.createdAtRange as unknown[]) : [];
  const from = toIso(range[0]);
  const to = toIso(range[1]);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return qs;
}

export default function AiUsagePage() {
  const { isMobile } = useResponsive();
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const timeRangePresets = useMemo(() => buildTimeRangePresets(), []);

  const columns: ProColumns<Row>[] = useMemo(
    () => [
      {
        title: "时间",
        dataIndex: "createdAt",
        width: 170,
        hideInSearch: true,
        render: (_, r) => <DateTimeCell value={r.createdAt} />,
      },
      {
        title: "功能",
        dataIndex: "feature",
        width: 140,
        valueType: "select",
        fieldProps: { allowClear: true, options: FEATURE_OPTIONS },
        render: (_, r) => <Tag style={{ margin: 0 }}>{FEATURE_LABELS[r.feature] ?? r.feature}</Tag>,
      },
      {
        title: "操作人",
        dataIndex: "userKeyword",
        hideInTable: true,
        fieldProps: { placeholder: "姓名 / 工号" },
      },
      {
        title: "操作人",
        dataIndex: "userName",
        width: 140,
        hideInSearch: true,
        render: (_, r) =>
          r.userEmployeeNo === "SYSTEM" ? (
            <Tag color="purple" style={{ margin: 0 }}>
              系统
            </Tag>
          ) : (
            <span>
              {r.userName}
              {r.userEmployeeNo ? (
                <span style={{ color: "var(--qt-text-faint)", marginLeft: 6, fontSize: 12 }}>
                  {r.userEmployeeNo}
                </span>
              ) : null}
            </span>
          ),
      },
      {
        title: "结果",
        dataIndex: "status",
        width: 80,
        valueType: "select",
        fieldProps: { allowClear: true },
        valueEnum: {
          SUCCESS: { text: "成功" },
          FAILURE: { text: "失败" },
        },
        render: (_, r) => {
          const tag = (
            <Tag color={r.status === "SUCCESS" ? "success" : "danger"} style={{ margin: 0 }}>
              {r.status === "SUCCESS" ? "成功" : "失败"}
            </Tag>
          );
          return r.status === "FAILURE" && r.errorMessage ? (
            <Tooltip title={r.errorMessage}>{tag}</Tooltip>
          ) : (
            tag
          );
        },
      },
      {
        title: "缓存",
        dataIndex: "cacheHit",
        width: 80,
        valueType: "select",
        fieldProps: { allowClear: true },
        valueEnum: {
          true: { text: "命中" },
          false: { text: "未命中" },
        },
        render: (_, r) =>
          r.cacheHit ? (
            <Tag color="blue" style={{ margin: 0 }}>
              命中
            </Tag>
          ) : (
            <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
          ),
      },
      {
        title: "模型",
        dataIndex: "model",
        width: 130,
        hideInSearch: true,
        render: (_, r) => (
          <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{r.model}</span>
        ),
      },
      {
        title: "Tokens",
        dataIndex: "promptTokens",
        width: 150,
        hideInSearch: true,
        render: (_, r) => (
          <Tooltip title={`输入 ${r.promptTokens} / 输出 ${r.completionTokens}`}>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
              {r.promptTokens} / {r.completionTokens}
            </span>
          </Tooltip>
        ),
      },
      {
        title: "估算成本",
        dataIndex: "costEstimate",
        width: 110,
        hideInSearch: true,
        render: (_, r) =>
          r.costEstimate === null ? (
            <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
          ) : (
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
              ${r.costEstimate.toFixed(6)}
            </span>
          ),
      },
      {
        title: "耗时",
        dataIndex: "latencyMs",
        width: 90,
        hideInSearch: true,
        render: (_, r) => <span style={{ fontSize: 12 }}>{r.latencyMs} ms</span>,
      },
      {
        title: "时间范围",
        dataIndex: "createdAtRange",
        valueType: "dateTimeRange",
        hideInTable: true,
        fieldProps: { presets: timeRangePresets },
      },
    ],
    [timeRangePresets],
  );

  return (
    <Page>
      <PageHeader
        title="AI 用量"
        subtitle="每次 AI 调用 (含缓存命中与失败) 一行日志;汇总卡与当前过滤条件同口径;成本为按刊例单价估算 (USD),非账单依据。"
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="总调用" value={summary.totalCalls} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="缓存命中率" value={summary.cacheHitRate} suffix="%" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="输入 Tokens" value={summary.promptTokens} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="输出 Tokens" value={summary.completionTokens} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="估算成本 (USD)"
              value={summary.costEstimate}
              precision={6}
              prefix="$"
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="失败 / 平均耗时" value={summary.failureCount} suffix={`/ ${summary.avgLatencyMs} ms`} />
          </Card>
        </Col>
      </Row>
      <ProTable<Row>
        rowKey="id"
        columns={columns}
        search={{
          labelWidth: "auto",
          defaultCollapsed: isMobile,
          layout: isMobile ? "vertical" : undefined,
        }}
        debounceTime={400}
        scroll={{ x: "max-content" }}
        cardBordered={false}
        sticky={isMobile}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: !isMobile,
          size: isMobile ? "small" : undefined,
        }}
        request={async (params) => {
          const qs = buildQuery(
            params as Record<string, unknown>,
            Number(params.current ?? 1),
            Number(params.pageSize ?? 20),
          );
          const res = await fetch(`/api/admin/ai-usage?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          setSummary(j.data.summary as Summary);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columnsState={{
          persistenceKey: "ai-usage-table-v1",
          persistenceType: "localStorage",
        }}
      />
    </Page>
  );
}
