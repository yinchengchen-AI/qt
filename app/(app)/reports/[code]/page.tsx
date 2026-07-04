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
import { reportColumnLabel, reportStatusLabel } from "@/lib/report-labels";

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

// 签约明细:与 2026年5月业务明细.pdf 字段一一对应(district+town / customer / service / signer / amount)
type SignerDetailRow = {
  contractId: string;
  contractNo: string;
  district: string | null;
  town: string | null;
  region: string;
  customerId: string;
  customerName: string;
  serviceType: string;
  serviceTypeLabel: string;
  signerId: string;
  signerName: string;
  signerEmployeeNo: string;
  signDate: string;
  totalAmount: number;
};
type SignerDetailGroup = {
  signerId: string;
  signerName: string;
  signerEmployeeNo: string;
  rows: SignerDetailRow[];
  contractAmount: number;
  subtotalWan: number;
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
      const body: Record<string, unknown> = { code, periodType, action: "find" };
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
      // 404 = 未生成报表, 不当作错误, 进入空态
      if (j.code === 404) {
        setData(null);
        return;
      }
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

  /**
   * 手动生成报表 (空态按钮 + 重新生成按钮共用同一接口)
   * - 已有快照: snapshotId 走 regenerateSnapshot (强制重算)
   * - 无快照:   action="generate" 走 generateSnapshot (建新)
   * - CUSTOM:   实时 live query, 不存快照
   */
  const handleGenerate = async () => {
    if (periodType === "CUSTOM" && (!customRange || !customRange[0] || !customRange[1])) {
      message.warning("请选择自定义日期范围");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { code, periodType };
      if (data?.snapshotId) {
        // 已有快照 → regenerate (强制重算)
        body.snapshotId = data.snapshotId;
      } else {
        // 无快照 → generate (按需创建, 带 hash 比对)
        body.action = "generate";
      }
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
      message.success(data?.snapshotId ? "重新生成成功" : "生成成功");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const exportExcel = async () => {
    if (!data) {
      message.warning("请先生成报表或选择自定义日期范围");
      return;
    }
    try {
      if (data.snapshotId) {
        // 快照路径 (MONTH/QUARTER/YEAR)
        await downloadExcel(`/api/reports/export?snapshotId=${data.snapshotId}`);
        return;
      }
      // 实时查询路径 (CUSTOM: data 没 snapshotId 但 payload 是 live aggregate 结果)
      if (periodType === "CUSTOM" && (!customRange || !customRange[0] || !customRange[1])) {
        message.warning("请选择自定义日期范围");
        return;
      }
      const params = new URLSearchParams({ code, periodType });
      if (periodType === "CUSTOM" && customRange) {
        const { from, to } = toDateRangeQuery(customRange);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      await downloadExcel(`/api/reports/export?${params}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const exportPdf = () => {
    if (periodType === "CUSTOM" && (!customRange || !customRange[0] || !customRange[1])) {
      message.warning("请选择自定义日期范围");
      return;
    }
    // 非 CUSTOM 周期: 没快照时 PDF 走 findSnapshot 会 404, 禁止导出
    if (periodType !== "CUSTOM" && !data?.snapshotId) {
      message.warning("请先生成报表再导出 PDF");
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
      // 员工业绩汇总场景: 不展示 userId / employeeNo (跟签约人 + 区域定位即可,
      // 不暴露工号/主键; 与 Excel Sheet 1 "员工业绩汇总" 行为保持一致)
      // 同时: 用 signerSummary (按签约人), 跟签约明细 + Excel Sheet 2 同口径;
      // 旧 payload.performance 按 owner 聚合, 跟签约明细对不上, 已弃用
      const raw = ((payload.signerSummary ?? payload.performance) as Record<string, unknown>[]) ?? [];
      return raw.map((r) => {
        const { userId: _u, employeeNo: _e, ...rest } = r;
        return rest as Record<string, unknown>;
      });
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

  // PERFORMANCE 专属:签约明细(按签约人分组的合同级明细,字段对齐 PDF 模板)
  const signerDetailGroups = useMemo<SignerDetailGroup[]>(() => {
    if (data?.definition.type !== "PERFORMANCE") return [];
    return (data.payload.signerDetail as SignerDetailGroup[] | undefined) ?? [];
  }, [data?.definition.type, data?.payload]);

  // 拼接签约明细 FlatList,每组末尾追加小计行,末行追加全公司合计
  // rowType: "detail" | "subtotal" | "total"
  const signerDetailRows = useMemo(() => {
    const flat: Array<SignerDetailRow & { rowType: "detail" | "subtotal" | "total"; subtotalWan?: number; signerName?: string; signerEmployeeNo?: string }> = [];
    for (const g of signerDetailGroups) {
      for (const r of g.rows) flat.push({ ...r, rowType: "detail" });
      flat.push({
        contractId: `${g.signerId}-subtotal`,
        contractNo: "",
        district: null,
        town: null,
        region: "",
        customerId: "",
        customerName: "",
        serviceType: "",
        serviceTypeLabel: "",
        signerId: g.signerId,
        signerName: g.signerName,
        signerEmployeeNo: g.signerEmployeeNo,
        signDate: "",
        totalAmount: g.contractAmount,
        rowType: "subtotal",
        subtotalWan: g.subtotalWan
      });
    }
    // 全公司合计行 (末行)
    const grandTotal = signerDetailGroups.reduce((s, g) => s + g.contractAmount, 0);
    const grandWan = round2(grandTotal / 10_000);
    flat.push({
      contractId: "__total__",
      contractNo: "",
      district: null,
      town: null,
      region: "",
      customerId: "",
      customerName: "",
      serviceType: "",
      serviceTypeLabel: "",
      signerId: "",
      signerName: "全公司合计",
      signerEmployeeNo: "",
      signDate: "",
      totalAmount: grandTotal,
      rowType: "total",
      subtotalWan: grandWan,
    });
    return flat;
  }, [signerDetailGroups]);

  const columns = useMemo(() => {
    if (tableData.length === 0) return [];
    return Object.keys(tableData[0]!).map((key) => ({
      title: reportColumnLabel(key),
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
            ) : data ? (
              <Authority code="REPORT_CENTER:UPDATE">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleGenerate}
                  loading={generating}
                >
                  重新生成
                </Button>
              </Authority>
            ) : (
              <Authority code="REPORT_CENTER:UPDATE">
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={handleGenerate}
                  loading={generating}
                >
                  生成报表
                </Button>
              </Authority>
            )}
            <Button
              icon={<DownloadOutlined />}
              onClick={exportExcel}
              disabled={!data}
            >
              导出 Excel
            </Button>
            <Button
              icon={<FilePdfOutlined />}
              onClick={exportPdf}
              disabled={periodType !== "CUSTOM" && !data?.snapshotId}
            >
              导出 PDF
            </Button>
          </Space>
        }
      />

      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <Spin spinning={loading}>
          {!data && !loading && periodType !== "CUSTOM" ? (
            // 未生成快照的空态: 显示大「生成报表」按钮, 引导用户手动生成
            <Card style={{ marginTop: 32 }}>
              <div style={{ textAlign: "center", padding: "40px 16px" }}>
                <div style={{ fontSize: 16, color: "var(--qt-text-secondary)", marginBottom: 8 }}>
                  本周期尚未生成经营报表
                </div>
                <div style={{ fontSize: 13, color: "var(--qt-text-tertiary)", marginBottom: 24 }}>
                  报表中心不再自动生成，请点击下方按钮手动生成。
                  生成过程会聚合当前数据并保存为快照，下次进入直接展示。
                </div>
                <Authority code="REPORT_CENTER:UPDATE">
                  <Button
                    type="primary"
                    size="large"
                    icon={<ReloadOutlined />}
                    onClick={handleGenerate}
                    loading={generating}
                  >
                    立即生成报表
                  </Button>
                </Authority>
              </div>
            </Card>
          ) : data ? (
            <>
              <Card size="small" style={{ marginBottom: 16 }}>
                <Space>
                  <span>
                    周期: <strong>{data.periodLabel}</strong>
                  </span>
                  <span>
                    状态:{" "}
                    <Tag color={data.status === "READY" ? "success" : "warning"}>
                      {reportStatusLabel(data.status)}
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

              {signerDetailGroups.length > 0 && (
                <Card
                  title="员工业绩明细（按签约人）"
                  style={{ marginBottom: 16 }}
                  extra={
                    <span style={{ color: "var(--qt-text-secondary)", fontSize: 12 }}>
                      字段:所属区域 / 企业名称 / 服务项目 / 签约人 / 合同金额;末列「小计(万元)」只对签约人小计行与全公司合计行填充
                    </span>
                  }
                >
                  <Table<typeof signerDetailRows[number]>
                    dataSource={signerDetailRows}
                    pagination={false}
                    size="small"
                    scroll={{ x: "max-content" }}
                    rowKey={(r) =>
                      r.rowType === "subtotal" || r.rowType === "total"
                        ? r.contractId
                        : `${r.contractId}-${r.signDate}`
                    }
                    rowClassName={(r) => {
                      if (r.rowType === "total") return "signer-total-row";
                      if (r.rowType === "subtotal") return "signer-subtotal-row";
                      return "";
                    }}
                    columns={[
                      { title: "所属区域", dataIndex: "region", key: "region", width: 180, render: (v: string, r) => r.rowType === "detail" ? (v || "-") : "" },
                      { title: "企业名称", dataIndex: "customerName", key: "customerName", width: 240, render: (v: string, r) => r.rowType === "detail" ? (v || "-") : "" },
                      { title: "服务项目", dataIndex: "serviceTypeLabel", key: "serviceTypeLabel", width: 180, render: (v: string, r) => r.rowType === "detail" ? (v || "-") : "" },
                      { title: "签约人", dataIndex: "signerName", key: "signerName", width: 110, render: (v: string, r) => r.rowType === "detail" ? (v || "-") : <strong>{v}</strong> },
                      { title: "合同金额（元）", dataIndex: "totalAmount", key: "totalAmount", width: 150, align: "right" as const,
                        render: (v: number, r) => {
                          if (r.rowType === "detail") return formatCurrency(v);
                          return <strong>{formatCurrency(v)}</strong>;
                        }
                      },
                      { title: "小计（万元）", dataIndex: "subtotalWan", key: "subtotalWan", width: 130, align: "right" as const,
                        render: (_: unknown, r) => r.rowType === "detail" ? "" : <strong>{r.subtotalWan != null ? Number(r.subtotalWan).toFixed(2) : ""}</strong>
                      },
                    ]}
                    summary={undefined}
                  />
                </Card>
              )}

              {/* PERFORMANCE 类型的明细已通过上面的"签约明细"展示, 此处不再重复"明细数据"卡
                  (旧逻辑: 把 signerSummary 当明细数据表展示, 跟签约明细 + KPI 卡片重复) */}
              {data.definition.type !== "PERFORMANCE" && (tableData as Record<string, unknown>[]).length > 0 && (
                <Card title="明细数据">
                  <Table
                    dataSource={tableData as Record<string, unknown>[]}
                    columns={columns}
                    rowKey={stableRowKey}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: "max-content" }}
                  />
                </Card>
              )}

              {data.definition.type !== "PERFORMANCE" &&
                (tableData as Record<string, unknown>[]).length === 0 &&
                !loading && (
                  <EmptyState empty title="暂无明细数据" description="当前周期范围内没有相关记录" />
                )}
            </>
          ) : null}
        </Spin>
      )}
    </Page>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
