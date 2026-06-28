"use client";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Col, DatePicker, Row, Space, App as AntdApp, Typography, Tag } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";
import { toDateRangeQuery } from "@/lib/date-range";

const { Text } = Typography;

// 业绩明细中开票率/回款率的 Tag 颜色阈值（百分比）
const INVOICE_RATE_THRESHOLDS = { green: 70, blue: 40 } as const;
const PAYMENT_RATE_THRESHOLDS = { green: 80, blue: 50 } as const;

type Row = {
  userId: string; name: string; employeeNo: string;
  contractAmount: number; invoiceAmount: number; paymentAmount: number; contractCount: number;
};

function rankEmoji(i: number) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "";
}

export default function PerformancePage() {
  const { isMobile } = useResponsive();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 与 dashboard 一致: 默认本月 1 号 00:00 ~ 当前; 用户可改/清空
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(() => [
    dayjs().startOf("month"),
    dayjs()
  ]);
  const { message } = AntdApp.useApp();

  const chartHeight = isMobile ? 240 : 380;
  // 移动端只显示 Top 5,完整数据可导出
  const TOP_N = isMobile ? 5 : 10;
  const visibleRows = isMobile && rows.length > TOP_N ? rows.slice(0, TOP_N) : rows;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      const { from, to } = toDateRangeQuery(range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/statistics/employee-performance?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    const qs = new URLSearchParams({ type: "employee-performance" });
    const { from, to } = toDateRangeQuery(range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await fetch(`/api/statistics/export?${qs}`, { credentials: "include" });
    if (!r.ok) { const j = await r.json(); message.error(j.message); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `员工业绩_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = useMemo(() => ({
    contract: rows.reduce((s, r) => s + r.contractAmount, 0),
    invoice: rows.reduce((s, r) => s + r.invoiceAmount, 0),
    payment: rows.reduce((s, r) => s + r.paymentAmount, 0),
    count: rows.reduce((s, r) => s + r.contractCount, 0),
  }), [rows]);

  const kpis: StatItem[] = [
    { label: "合同总额", value: formatCompact(totals.contract), suffix: "", description: `共 ${totals.count} 份` },
    { label: "已开票总额", value: formatCompact(totals.invoice), suffix: "", description: `开票率 ${totals.contract > 0 ? ((totals.invoice / totals.contract) * 100).toFixed(1) : 0}%` },
    { label: "已回款总额", value: formatCompact(totals.payment), suffix: "", description: `回款率 ${totals.invoice > 0 ? ((totals.payment / totals.invoice) * 100).toFixed(1) : 0}%` },
    { label: "员工人数", value: rows.length, suffix: "人", description: `人均 ${formatCompact(totals.contract / Math.max(rows.length, 1))} 元` },
  ];

  // 图表用 Top N 数据
  const contractChartData = visibleRows.map(r => ({ name: r.name, value: r.contractAmount, type: "合同额" }));
  const invoiceChartData = visibleRows.map(r => ({ name: r.name, value: r.invoiceAmount, type: "已开票" }));
  const paymentChartData = visibleRows.map(r => ({ name: r.name, value: r.paymentAmount, type: "已回款" }));

  return (
    <Page>
      <PageHeader
        title="员工业绩"
        subtitle="按员工汇总合同、开票、回款（销售仅看自己负责的客户）；支持时间范围筛选"
        actions={
          <Space wrap>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
              allowClear
            />
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
            <Col xs={24} lg={12}>
              <ProCard title="合同额排行">
                {contractChartData.length > 0 ? (
                  <Column data={contractChartData} xField="name" yField="value" height={chartHeight} colorField="type" autoFit
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
            <Col xs={24} lg={12}>
              <ProCard title="已开票排行">
                {invoiceChartData.length > 0 ? (
                  <Column data={invoiceChartData} xField="name" yField="value" height={chartHeight} colorField="type" autoFit
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <ProCard title="已回款排行">
                {paymentChartData.length > 0 ? (
                  <Column data={paymentChartData} xField="name" yField="value" height={chartHeight} colorField="type" autoFit
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
            <Col xs={24} lg={12}>
              <ProCard title="合同数量排行">
                {rows.length > 0 ? (
                  <Column data={visibleRows.map(r => ({ name: r.name, value: r.contractCount }))} xField="name" yField="value" height={chartHeight} autoFit
                    label={{ text: (d: Record<string, unknown>) => String(d.value), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <div style={{ marginTop: 32 }}>
            <PageHeader
              level="section"
              title={`业绩明细${isMobile && rows.length > TOP_N ? `（Top ${TOP_N}）` : ""}`}
            />
            <ProCard>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 620 : undefined }}>
                  <thead>
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
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      const invRate = r.contractAmount > 0 ? (r.invoiceAmount / r.contractAmount * 100) : 0;
                      const payRate = r.invoiceAmount > 0 ? (r.paymentAmount / r.invoiceAmount * 100) : 0;
                      return (
                        <tr key={r.userId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "10px 8px" }}>
                            {rankEmoji(i) || <Text type="secondary">{i + 1}</Text>}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <Text strong>{r.name}</Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>{r.employeeNo}</Text>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.contractCount}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.contractAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.invoiceAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.paymentAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={invRate >= INVOICE_RATE_THRESHOLDS.green ? "green" : invRate >= INVOICE_RATE_THRESHOLDS.blue ? "blue" : "orange"}>{invRate.toFixed(1)}%</Tag>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={payRate >= PAYMENT_RATE_THRESHOLDS.green ? "green" : payRate >= PAYMENT_RATE_THRESHOLDS.blue ? "blue" : "orange"}>{payRate.toFixed(1)}%</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isMobile && rows.length > TOP_N ? (
                <div style={{ marginTop: 12, textAlign: "center", color: "var(--qt-processing)", fontSize: 13 }}>
                  共 {rows.length} 条，完整数据请使用「导出 xlsx」
                </div>
              ) : null}
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
