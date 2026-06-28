"use client";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, DatePicker, Row, Space, App as AntdApp, Typography, Tag, theme } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";
import { toDateRangeQuery } from "@/lib/date-range";
import type { RegionStatRow } from "@/server/services/statistics";

const { Text } = Typography;
const { useToken } = theme;

// 与员工业绩页一致:开票率/回款率的 Tag 颜色阈值
const INVOICE_RATE_THRESHOLDS = { green: 70, blue: 40 } as const;
const PAYMENT_RATE_THRESHOLDS = { green: 80, blue: 50 } as const;

// 与 service 的 RegionStatRow 保持同形,避免字段漂移

function rankEmoji(i: number) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "";
}

export default function ByRegionPage() {
  const { isMobile } = useResponsive();
  const router = useRouter();
  const { token } = useToken();
  const [rows, setRows] = useState<RegionStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 默认本年度(1 月 1 日 00:00 ~ 当前);用户可改/清空
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(() => [
    dayjs().startOf("year"),
    dayjs()
  ]);
  const { message } = AntdApp.useApp();

  const chartHeight = isMobile ? 240 : 380;
  // 移动端只显示 Top 5,完整数据可导出
  const TOP_N = isMobile ? 5 : 10;
  // 过滤掉排在末尾的 "未填写" 行(避免图表把它排进 Top N)
  const realRows = useMemo(() => rows.filter((r) => r.district || r.town), [rows]);
  const visibleRows = isMobile && realRows.length > TOP_N ? realRows.slice(0, TOP_N) : realRows;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      const { from, to } = toDateRangeQuery(range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/statistics/by-region?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    const qs = new URLSearchParams({ type: "by-region" });
    const { from, to } = toDateRangeQuery(range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await fetch(`/api/statistics/export?${qs}`, { credentials: "include" });
    if (!r.ok) { const j = await r.json(); message.error(j.message); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `区域统计_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 总额按 realRows(已剔除"未填写");KPI 同时显式呈现"未填写"客户数,口径与表格脚注一致
  const unfilledCount = useMemo(
    () => rows.find((r) => !r.district && !r.town)?.customerCount ?? 0,
    [rows]
  );
  const totals = useMemo(() => ({
    contract: realRows.reduce((s, r) => s + r.contractAmount, 0),
    invoice: realRows.reduce((s, r) => s + r.invoiceAmount, 0),
    payment: realRows.reduce((s, r) => s + r.paymentAmount, 0),
    count: realRows.reduce((s, r) => s + r.contractCount, 0),
    customerTotal: realRows.reduce((s, r) => s + r.customerCount, 0)
  }), [realRows]);

  const kpis: StatItem[] = [
    { label: "合同总额", value: formatCompact(totals.contract), suffix: "", description: `共 ${totals.count} 份` },
    { label: "已开票总额", value: formatCompact(totals.invoice), suffix: "", description: `开票率 ${totals.contract > 0 ? ((totals.invoice / totals.contract) * 100).toFixed(1) : 0}%` },
    { label: "已回款总额", value: formatCompact(totals.payment), suffix: "", description: `回款率 ${totals.invoice > 0 ? ((totals.payment / totals.invoice) * 100).toFixed(1) : 0}%` },
    { label: "已分类区域数", value: realRows.length, suffix: "个", description: `覆盖 ${totals.customerTotal} 位客户` + (unfilledCount > 0 ? ` / 另有 ${unfilledCount} 位未填写` : "") }
  ];

  // 分组柱状图数据:每个区域 2 条记录(合同额 / 已回款),用 colorField 区分颜色
  const groupedChartData = visibleRows.flatMap((r) => [
    { name: r.region, value: r.contractAmount, type: "合同额" },
    { name: r.region, value: r.paymentAmount, type: "已回款" }
  ]);

  return (
    <Page>
      <PageHeader
        title="区域统计"
        subtitle="按客户所在镇街汇总合同、开票、回款（销售仅看自己负责的客户）；支持时间范围筛选"
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
          <Alert
            type="info"
            showIcon
            title="默认范围为本年度（1 月 1 日 00:00 ~ 当前时刻），可使用上方时间选择器调整或清空"
            style={{ marginBottom: 16 }}
          />
          <StatGrid items={kpis} columns={4} loading={loading && rows.length === 0} />

          <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
            <Col xs={24}>
              <ProCard title="合同额 vs 已回款 排行">
                {groupedChartData.length > 0 ? (
                  <Column
                    data={groupedChartData}
                    xField="name"
                    yField="value"
                    colorField="type"
                    height={chartHeight}
                    autoFit
                    transform={[{ type: "dodgeX" }]}
                    scale={{ color: { range: ["#1677ff", "#52c41a"] } }}
                    legend={{ color: { position: "top", layout: { justifyContent: "flex-end" } } }}
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                    xAxis={{ label: { autoRotate: true, autoHide: false } }}
                  />
                ) : <EmptyState empty title="暂无区域数据" description="当前时间范围内没有任何区域有合同、开票或回款" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <div style={{ marginTop: 32 }}>
            <PageHeader
              level="section"
              title={`区域明细${isMobile && realRows.length > TOP_N ? `（Top ${TOP_N}）` : ""}`}
              subtitle="点击行可查看该区域下的客户列表"
            />
            <ProCard>
              {visibleRows.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 720 : undefined }}>
                    <thead>
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
                    </thead>
                    <tbody>
                      {visibleRows.map((r, i) => {
                        const invRate = r.invoiceRate;
                        const payRate = r.paymentRate;
                        return (
                          <tr
                            key={r.region}
                            style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}
                            onClick={() => {
                  const qs = new URLSearchParams();
                  if (r.district) qs.set("district", r.district);
                  if (r.town) qs.set("town", r.town);
                  router.push(`/customers${qs.toString() ? `?${qs}` : ""}`);
                }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                const qs = new URLSearchParams();
                                if (r.district) qs.set("district", r.district);
                                if (r.town) qs.set("town", r.town);
                                router.push(`/customers${qs.toString() ? `?${qs}` : ""}`);
                              }
                            }}
                            tabIndex={0}
                          >
                            <td style={{ padding: "10px 8px" }}>
                              {rankEmoji(i) || <Text type="secondary">{i + 1}</Text>}
                            </td>
                            <td style={{ padding: "10px 8px" }}>
                              <Text strong style={{ color: token.colorPrimary }}>{r.region}</Text>
                            </td>
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.customerCount}</td>
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
                            <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.unpaidAmount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState empty title="暂无区域明细" description="当前时间范围内没有任何区域有合同、开票或回款" height="tall" />
              )}
              {isMobile && realRows.length > TOP_N ? (
                <div style={{ marginTop: 12, textAlign: "center", color: "var(--qt-processing)", fontSize: 13 }}>
                  共 {realRows.length} 条，完整数据请使用「导出 xlsx」
                </div>
              ) : null}
              {rows.some((r) => !r.district && !r.town) ? (
                <div style={{ marginTop: 8, textAlign: "right", color: "var(--qt-text-secondary)", fontSize: 12 }}>
                  注：另有 {rows.find((r) => !r.district && !r.town)?.customerCount ?? 0} 位未填写所在镇街的客户，未在上表显示
                </div>
              ) : null}
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
