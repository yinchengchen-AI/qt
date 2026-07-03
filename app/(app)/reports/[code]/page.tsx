"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Button,
  Card,
  DatePicker,
  Space,
  Tabs,
  Tag,
  message,
  Spin,
  Table,
  Statistic,
  Row,
  Col,
} from "antd";
import {
  DownloadOutlined,
  FilePdfOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { downloadExcel } from "@/lib/excel-client";
import { openPrintWindow } from "@/lib/print-client";
import { toDateRangeQuery } from "@/lib/date-range";
import { formatCurrency } from "@/lib/format";
import { Authority } from "@/components/authority";

const PERIOD_TABS = [
  { key: "MONTH", label: "月报" },
  { key: "QUARTER", label: "季报" },
  { key: "YEAR", label: "年报" },
  { key: "CUSTOM", label: "自定义" },
] as const;

type Definition = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  periodType: string;
  defaultMetrics: Array<{ key: string; label: string; unit: string }>;
  dimensions: string[];
};

type ReportResult = {
  snapshotId?: string;
  definition: Definition;
  periodType: string;
  periodLabel: string;
  from: string;
  to: string;
  status: string;
  payload: Record<string, unknown>;
  generatedAt?: string;
};

function formatTableValue(key: string, value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("count") ||
      lowerKey.includes("days") ||
      lowerKey.includes("invoicecount") ||
      lowerKey.includes("customercount")
    ) {
      return String(value);
    }
    if (lowerKey.includes("rate") || lowerKey.includes("ratio")) {
      return `${value.toFixed(2)}%`;
    }
    return formatCurrency(value);
  }
  return String(value);
}

function stableRowKey(row: Record<string, unknown>, index?: number): string {
  // 常见主键字段
  const candidates = ["id", "userId", "employeeNo", "region", "month", "contractId", "customerId"];
  for (const k of candidates) {
    if (row[k] != null) return String(row[k]);
  }
  return `row-${index}`;
}

export default function ReportDetailPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [periodType, setPeriodType] = useState<string>("MONTH");
  const [customRange, setCustomRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (periodType === "CUSTOM" && (!customRange || !customRange[0] || !customRange[1])) {
      message.warning("请选择自定义日期范围");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { code, periodType };
      if (periodType === "CUSTOM" && customRange) {
        const { from, to } = toDateRangeQuery(customRange);
        body.from = from;
        body.to = to;
      }
      const r = await fetch("/api/reports/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setData(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code, periodType, customRange]);

  // 非自定义周期自动加载；自定义周期需用户点击查询
  useEffect(() => {
    if (periodType !== "CUSTOM") {
      load();
    } else {
      setData(null);
    }
  }, [code, periodType, load]);

  const regenerate = async () => {
    if (!data?.snapshotId) {
      message.warning("自定义范围报表不支持重新生成快照");
      return;
    }
    setGenerating(true);
    try {
      const r = await fetch("/api/reports/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, periodType, snapshotId: data.snapshotId }),
        credentials: "include",
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      message.success("重新生成成功");
      setData(j.data);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const exportExcel = async () => {
    if (!data?.snapshotId) {
      message.warning("请先选择周期并生成快照");
      return;
    }
    try {
      await downloadExcel(`/api/reports/export?snapshotId=${data.snapshotId}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const exportPdf = () => {
    if (periodType === "CUSTOM" && (!customRange || !customRange[0] || !customRange[1])) {
      message.warning("请选择自定义日期范围");
      return;
    }
    const qs = new URLSearchParams({ periodType });
    if (periodType === "CUSTOM" && customRange) {
      const { from, to } = toDateRangeQuery(customRange);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
    }
    openPrintWindow(`/api/reports/${code}/pdf?${qs}`);
  };

  const overview = (data?.payload?.overview ?? {}) as Record<string, number>;

  const tableData = useMemo(() => {
    const payload = data?.payload ?? {};
    const type = data?.definition.type;
    if (type === "PERFORMANCE") {
      return (payload.performance as Record<string, unknown>[]) ?? [];
    }
    if (type === "BUSINESS") {
      return (payload.region as Record<string, unknown>[]) ?? [];
    }
    if (type === "CUSTOM") {
      return (
        (payload.region as Record<string, unknown>[]) ??
        (payload.series as Record<string, unknown>[]) ??
        []
      );
    }
    return (payload.series as Record<string, unknown>[]) ?? [];
  }, [data?.definition.type, data?.payload]);

  const columns = useMemo(() => {
    if (tableData.length === 0) return [];
    return Object.keys(tableData[0]!).map((key) => ({
      title: key,
      dataIndex: key,
      key,
      render: (v: unknown) => formatTableValue(key, v),
    }));
  }, [tableData]);

  return (
    <Page>
      <PageHeader
        title={data?.definition.name ?? "报表详情"}
        subtitle={data?.definition.description ?? "加载中..."}
        back={() => window.history.back()}
        actions={
          <Space wrap>
            <Tabs
              activeKey={periodType}
              onChange={(k) => {
                setPeriodType(k);
              }}
              items={PERIOD_TABS.map((t) => ({ key: t.key, label: t.label }))}
            />
            {periodType === "CUSTOM" && (
              <DatePicker.RangePicker
                value={customRange}
                onChange={(v) => setCustomRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
              />
            )}
            {periodType === "CUSTOM" ? (
              <Button icon={<SearchOutlined />} onClick={load} loading={loading}>
                查询
              </Button>
            ) : (
              <Authority code="REPORT_CENTER:UPDATE">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={regenerate}
                  loading={generating || loading}
                >
                  重新生成
                </Button>
              </Authority>
            )}
            <Button icon={<DownloadOutlined />} onClick={exportExcel}>
              导出 Excel
            </Button>
            <Button icon={<FilePdfOutlined />} onClick={exportPdf}>
              导出 PDF
            </Button>
          </Space>
        }
      />

      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <Spin spinning={loading}>
          {data && (
            <>
              <Card size="small" style={{ marginBottom: 16 }}>
                <Space>
                  <span>
                    周期: <strong>{data.periodLabel}</strong>
                  </span>
                  <span>
                    状态:{" "}
                    <Tag color={data.status === "READY" ? "success" : "warning"}>
                      {data.status}
                    </Tag>
                  </span>
                  {data.generatedAt && (
                    <span style={{ color: "#9ca3af" }}>
                      生成时间: {new Date(data.generatedAt).toLocaleString("zh-CN")}
                    </span>
                  )}
                </Space>
              </Card>

              {data.definition.defaultMetrics.length > 0 && (
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  {data.definition.defaultMetrics.map((m) => (
                    <Col key={m.key} xs={12} md={8} lg={6} xl={4}>
                      <Card>
                        <Statistic
                          title={m.label}
                          value={overview[m.key] ?? 0}
                          precision={m.unit === "%" ? 2 : 2}
                          suffix={m.unit === "元" ? "" : m.unit}
                          formatter={(v) =>
                            m.unit === "%"
                              ? `${Number(v).toFixed(2)}%`
                              : formatCurrency(Number(v))
                          }
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}

              {tableData.length > 0 && (
                <Card title="明细数据">
                  <Table
                    dataSource={tableData}
                    columns={columns}
                    rowKey={stableRowKey}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: "max-content" }}
                  />
                </Card>
              )}

              {tableData.length === 0 && !loading && (
                <EmptyState empty title="暂无明细数据" description="当前周期范围内没有相关记录" />
              )}
            </>
          )}
        </Spin>
      )}
    </Page>
  );
}
