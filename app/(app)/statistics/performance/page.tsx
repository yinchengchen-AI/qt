"use client";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Col, DatePicker, Row, Segmented, Space, App as AntdApp, Typography, Tag, Drawer, Spin, Descriptions, theme } from "antd";
import { DownloadOutlined, FilePdfOutlined, FileTextOutlined, AuditOutlined, MoneyCollectOutlined, TeamOutlined, EnvironmentOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency } from "@/lib/format";
import { downloadExcel } from "@/lib/excel-client";
import { useResponsive } from "@/lib/use-breakpoint";
import { presetRange, toDateRangeQuery, type RangePreset } from "@/lib/date-range";
import { openPrintWindow } from "@/lib/print-client";
import {
  CATEGORICAL_COLORS,
  INVOICE_RATE_THRESHOLDS,
  PAYMENT_RATE_THRESHOLDS,
  calcRates,
  rankEmoji,
  rateTagColor
} from "@/lib/stats-ui";

const { Text } = Typography;
const { useToken } = theme;

type Dimension = "owner" | "signer" | "region";

// 统一业绩排行行结构:与 GET /api/statistics/performance 返回的 row 同形。
// owner/signer 行 key=userId + employeeNo;region 行 key=区域展示名 + district/town/customerCount
type Row = {
  rank: number; key: string; name: string;
  employeeNo?: string | null;
  region?: string | null; district?: string | null; town?: string | null;
  customerCount?: number;
  contractCount: number; contractAmount: number; invoiceAmount: number; paymentAmount: number;
  invoiceRate: number; paymentRate: number; unpaidAmount: number;
};

const DIMENSION_OPTIONS: { value: Dimension; label: string }[] = [
  { value: "owner", label: "按员工" },
  { value: "signer", label: "按签约人" },
  { value: "region", label: "按区域" }
];

const PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "month", label: "本月" },
  { value: "quarter", label: "本季" },
  { value: "year", label: "本年" }
];

type MetricKey = "contract" | "invoice" | "payment" | "count";
const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: "contract", label: "合同额" },
  { value: "invoice", label: "已开票" },
  { value: "payment", label: "已回款" },
  { value: "count", label: "合同数" }
];

export default function PerformancePage() {
  const { isMobile } = useResponsive();
  const router = useRouter();
  const { token } = useToken();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 维度:默认按签约人(与改版前口径一致);切换维度会重取数并重置图表指标
  const [dimension, setDimension] = useState<Dimension>("signer");
  const isRegion = dimension === "region";
  // 区间:预设优先(本月/本季/本年,默认本年);RangePicker 自定义时清掉预设改传 from/to
  const [preset, setPreset] = useState<RangePreset | null>("year");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => {
    const { from, to } = presetRange("year");
    return [dayjs(from), dayjs(to)];
  });
  const { message } = AntdApp.useApp();

  const chartHeight = isMobile ? 240 : 380;
  // 移动端只显示 Top 5,完整数据可导出
  const TOP_N = isMobile ? 5 : 10;
  // region 维度过滤掉排在末尾的 "未填写" 行(避免图表把它排进 Top N)
  const realRows = useMemo(
    () => (isRegion ? rows.filter((r) => r.district || r.town) : rows),
    [rows, isRegion]
  );
  const visibleRows = isMobile && realRows.length > TOP_N ? realRows.slice(0, TOP_N) : realRows;
  const unfilledCount = useMemo(
    () => (isRegion ? rows.find((r) => !r.district && !r.town)?.customerCount ?? 0 : 0),
    [rows, isRegion]
  );

  // 主接口/导出:preset 激活传 preset,否则传 from/to
  const applyRangeParams = useCallback((qs: URLSearchParams) => {
    if (preset) {
      qs.set("preset", preset);
      return;
    }
    const { from, to } = toDateRangeQuery(range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
  }, [preset, range]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ dimension });
      applyRangeParams(qs);
      const r = await fetch(`/api/statistics/performance?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [dimension, applyRangeParams]);

  useEffect(() => { load(); }, [load]);

  const onDimensionChange = (v: Dimension) => {
    setDimension(v);
    setMetric("contract");
  };
  const onPresetChange = (v: RangePreset) => {
    setPreset(v);
    const { from, to } = presetRange(v);
    setRange([dayjs(from), dayjs(to)]);
  };
  const onRangeChange = (v: [Dayjs, Dayjs] | null) => {
    setRange(v);
    setPreset(null);
  };

  // 业绩明细抽屉:点击行时按 userId 拉明细(owner/signer 维度)
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    signer: { id: string; name: string; employeeNo: string } | null;
    rows: Array<{
      contractId: string; contractNo: string; region: string;
      customerName: string; serviceTypeLabel: string; signDate: string;
      totalAmount: number;
    }>;
    totals: { contractCount: number; contractAmount: number; subtotalWan: number };
  } | null>(null);

  const openDrawer = useCallback(async (userId: string) => {
    setDrawerUserId(userId);
    setDrawerLoading(true);
    try {
      const qs = new URLSearchParams({ userId });
      // 明细旧端点只认 from/to;preset 选中时 range 同步过,口径一致
      const { from, to } = toDateRangeQuery(range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/statistics/employee-performance/detail?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setDrawerData(j.data);
    } catch (e) {
      message.error((e as Error).message);
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  }, [range, message]);

  const closeDrawer = () => {
    setDrawerUserId(null);
    setDrawerData(null);
  };

  // region 维度行点击下钻到客户列表(仅当 district/town 有值)
  const drillToCustomers = useCallback((r: Row) => {
    if (!r.district && !r.town) return;
    router.push(`/customers?district=${encodeURIComponent(r.district ?? "")}&town=${encodeURIComponent(r.town ?? "")}`);
  }, [router]);

  const downloadPdf = () => {
    const qs = new URLSearchParams({ dimension });
    applyRangeParams(qs);
    try {
      openPrintWindow(`/api/statistics/performance/pdf?${qs}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const download = async () => {
    const qs = new URLSearchParams({ type: "performance", dimension });
    applyRangeParams(qs);
    // 走 downloadExcel:从服务端 Content-Disposition 拿真实文件名,中文不会被截断
    try {
      await downloadExcel(`/api/statistics/export?${qs}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 总额按 realRows(region 维度已剔除"未填写");KPI 同时显式呈现"未填写"客户数,口径与表格脚注一致
  const totals = useMemo(() => ({
    contract: realRows.reduce((s, r) => s + r.contractAmount, 0),
    invoice: realRows.reduce((s, r) => s + r.invoiceAmount, 0),
    payment: realRows.reduce((s, r) => s + r.paymentAmount, 0),
    count: realRows.reduce((s, r) => s + r.contractCount, 0),
    customerTotal: realRows.reduce((s, r) => s + (r.customerCount ?? 0), 0)
  }), [realRows]);

  const { invoiceRate: invRateTotal, paymentRate: payRateTotal } = calcRates(
    totals.contract, totals.invoice, totals.payment
  );
  const kpis: StatItem[] = [
    { label: "合同总额", icon: <FileTextOutlined />, value: formatCompact(totals.contract), suffix: "", description: `共 ${totals.count} 份` },
    { label: "已开票总额", icon: <AuditOutlined />, value: formatCompact(totals.invoice), suffix: "", description: `开票率 ${invRateTotal.toFixed(1)}%`, progress: invRateTotal },
    { label: "已回款总额", icon: <MoneyCollectOutlined />, value: formatCompact(totals.payment), suffix: "", description: `回款率 ${payRateTotal.toFixed(1)}%`, progress: payRateTotal },
    isRegion
      ? { label: "已分类区域数", icon: <EnvironmentOutlined />, value: realRows.length, suffix: "个", description: `覆盖 ${totals.customerTotal} 位客户` + (unfilledCount > 0 ? ` / 另有 ${unfilledCount} 位未填写` : "") }
      : { label: "员工人数", icon: <TeamOutlined />, value: realRows.length, suffix: "人", description: `人均 ${formatCompact(totals.contract / Math.max(realRows.length, 1))} 元` }
  ];

  // 按实体名(员工/区域)字典序分配稳定颜色,保证同一实体在指标切换时颜色一致
  const entityColorMap = useMemo(() => {
    const uniqueNames = Array.from(new Set(realRows.map((r) => r.name))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const map = new Map<string, string>();
    uniqueNames.forEach((name, i) => {
      map.set(name, CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length] ?? CATEGORICAL_COLORS[0]);
    });
    return map;
  }, [realRows]);

  // 图表用 Top N 数据,每个实体绑定固定颜色;
  // 4 个指标(合同额/已开票/已回款/合同数)共用一张图,Segmented 切换 — 同一批实体同一配色,只是 y 不同
  const [metric, setMetric] = useState<MetricKey>("contract");
  const metricValue = (r: Row): number =>
    metric === "contract" ? r.contractAmount
    : metric === "invoice" ? r.invoiceAmount
    : metric === "payment" ? r.paymentAmount
    : r.contractCount;
  const metricLabel = METRIC_OPTIONS.find((o) => o.value === metric)?.label ?? "";
  const dimensionLabel = DIMENSION_OPTIONS.find((o) => o.value === dimension)?.label ?? "";
  const chartData = visibleRows.map(r => ({
    name: r.name,
    value: metricValue(r),
    color: entityColorMap.get(r.name) ?? CATEGORICAL_COLORS[0]
  }));

  return (
    <Page>
      <PageHeader
        title="业绩排行"
        subtitle="按员工 / 签约人 / 区域三个维度汇总合同、开票、回款(业务人员仅看自己负责的合同);支持时间范围筛选"
        actions={
          <Space wrap>
            <Segmented<RangePreset>
              options={PRESET_OPTIONS}
              value={preset ?? undefined}
              onChange={onPresetChange}
            />
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => onRangeChange(v as [Dayjs, Dayjs] | null)}
              allowClear
            />
            <Button icon={<FilePdfOutlined />} onClick={downloadPdf}>导出 PDF</Button>
            <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
          </Space>
        }
      />

      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={kpis} columns={4} loading={loading && rows.length === 0} />

          <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
            <Col xs={24}>
              <ProCard
                title={isMobile ? `${dimensionLabel}排行` : `${dimensionLabel}排行（${metricLabel}）`}
                extra={
                  <Space wrap>
                    <Segmented<Dimension>
                      options={DIMENSION_OPTIONS}
                      value={dimension}
                      onChange={onDimensionChange}
                      size="small"
                    />
                    <Segmented<MetricKey>
                      options={METRIC_OPTIONS}
                      value={metric}
                      onChange={(v) => setMetric(v)}
                      size="small"
                    />
                  </Space>
                }
              >
                {chartData.length > 0 ? (
                  <Column data={chartData} xField="name" yField="value" colorField="color" height={chartHeight} autoFit legend={false}
                    tooltip={{ title: (d: Record<string, unknown>) => String(d.name), items: [(d: Record<string, unknown>) => ({ name: metricLabel, value: d.value })] }}
                    label={{ text: (d: Record<string, unknown>) => metric === "count" ? String(d.value) : formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title={isRegion ? "暂无区域数据" : "暂无员工业绩"} description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <div style={{ marginTop: 32 }}>
            <PageHeader
              level="section"
              title={`${isRegion ? "区域" : "业绩"}明细${isMobile && realRows.length > TOP_N ? `（Top ${TOP_N}）` : ""}`}
              subtitle={isRegion ? "点击行可查看该区域下的客户列表" : undefined}
            />
            <ProCard>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? (isRegion ? 720 : 620) : undefined }}>
                  <thead>
                    {isRegion ? (
                      <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                        <th style={{ padding: "10px 8px", width: 50 }}>#</th>
                        <th style={{ padding: "10px 8px" }}>区域</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>客户数</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>合同数</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>合同额</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>已开票</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>已回款</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>开票率</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>回款率</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>未回款</th>
                      </tr>
                    ) : (
                      <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                        <th style={{ padding: "10px 8px", width: 50 }}>#</th>
                        <th style={{ padding: "10px 8px" }}>员工</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>合同数</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>合同额</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>已开票</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>已回款</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>开票率</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>回款率</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      if (isRegion) {
                        return (
                          <tr
                            key={r.key}
                            style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}
                            onClick={() => drillToCustomers(r)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                drillToCustomers(r);
                              }
                            }}
                            tabIndex={0}
                          >
                            <td style={{ padding: "10px 8px" }}>
                              {rankEmoji(i) || <Text type="secondary">{i + 1}</Text>}
                            </td>
                            <td style={{ padding: "10px 8px" }}>
                              <Text strong style={{ color: token.colorPrimary }}>{r.name}</Text>
                            </td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.customerCount ?? 0}</td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.contractCount}</td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.contractAmount)}</td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.invoiceAmount)}</td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.paymentAmount)}</td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>
                              <Tag color={rateTagColor(r.invoiceRate, INVOICE_RATE_THRESHOLDS)}>{r.invoiceRate.toFixed(1)}%</Tag>
                            </td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>
                              <Tag color={rateTagColor(r.paymentRate, PAYMENT_RATE_THRESHOLDS)}>{r.paymentRate.toFixed(1)}%</Tag>
                            </td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.unpaidAmount)}</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={r.key} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => openDrawer(r.key)}>
                          <td style={{ padding: "10px 8px" }}>
                            {rankEmoji(i) || <Text type="secondary">{i + 1}</Text>}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <a onClick={(e) => { e.stopPropagation(); openDrawer(r.key); }} style={{ color: "var(--ant-color-link, #1677ff)" }}>
                              <Text strong>{r.name}</Text>
                            </a>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>{r.employeeNo ?? ""}</Text>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.contractCount}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.contractAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.invoiceAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.paymentAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={rateTagColor(r.invoiceRate, INVOICE_RATE_THRESHOLDS)}>{r.invoiceRate.toFixed(1)}%</Tag>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={rateTagColor(r.paymentRate, PAYMENT_RATE_THRESHOLDS)}>{r.paymentRate.toFixed(1)}%</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isMobile && realRows.length > TOP_N ? (
                <div style={{ marginTop: 12, textAlign: "center", color: "var(--qt-processing)", fontSize: 13 }}>
                  共 {realRows.length} 条，完整数据请使用「导出 xlsx」
                </div>
              ) : null}
              {isRegion && rows.some((r) => !r.district && !r.town) ? (
                <div style={{ marginTop: 8, textAlign: "right", color: "var(--qt-text-secondary)", fontSize: 12 }}>
                  注：另有 {unfilledCount} 位未填写所在镇街的客户，未在上表显示
                </div>
              ) : null}
            </ProCard>
          </div>
        </>
      )}

      <Drawer
        title={drawerData?.signer
          ? `${drawerData.signer.name}（${drawerData.signer.employeeNo}）· 业绩明细`
          : "业绩明细"}
        open={drawerUserId !== null}
        onClose={closeDrawer}
        width={isMobile ? "100%" : 720}
        destroyOnHidden
      >
        {drawerLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : drawerData?.signer ? (
          <>
            <Descriptions size="small" column={isMobile ? 1 : 3} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="合同份数">{drawerData.totals.contractCount}</Descriptions.Item>
              <Descriptions.Item label="合同总额">{formatCurrency(drawerData.totals.contractAmount)}</Descriptions.Item>
              <Descriptions.Item label="合计（万元）">{drawerData.totals.subtotalWan.toFixed(2)}</Descriptions.Item>
            </Descriptions>
            {drawerData.rows.length === 0 ? (
              <EmptyState empty title="暂无合同明细" description="当前时间范围内该员工作为签约人没有合同" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>所属区域</th>
                      <th style={{ padding: "8px" }}>企业名称</th>
                      <th style={{ padding: "8px" }}>服务项目</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>合同金额</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>签约日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerData.rows.map((r) => (
                      <tr key={r.contractId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px" }}>{r.region}</td>
                        <td style={{ padding: "8px" }}>{r.customerName}</td>
                        <td style={{ padding: "8px" }}>{r.serviceTypeLabel}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{formatCurrency(r.totalAmount)}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{dayjs(r.signDate).format("YYYY-MM-DD")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState empty title="暂无数据" />
        )}
      </Drawer>
    </Page>
  );
}
