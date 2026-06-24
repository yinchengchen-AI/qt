"use client";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { HintBox } from "@/components/callout";
import { StatusTag } from "@/components/status-tag";
import { formatCurrency } from "@/lib/format";
import { Progress, Space, Tag, Typography, theme } from "antd";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;
const { useToken } = theme;

type Bucket = "0-30" | "31-60" | "61-90" | "90+";
type AgingRow = {
  invoiceId: string; invoiceNo: string; customerName: string;
  daysOverdue: number; remaining: number; bucket: Bucket; status?: string;
};

const BUCKETS: Bucket[] = ["0-30", "31-60", "61-90", "90+"];

const BUCKET_META: Record<Bucket, { label: string; color: string; severity: "success" | "processing" | "warning" | "error" }> = {
  "0-30":  { label: "0 — 30 天", color: "#52c41a", severity: "success" },
  "31-60": { label: "31 — 60 天", color: "#1677ff", severity: "processing" },
  "61-90": { label: "61 — 90 天", color: "#faad14", severity: "warning" },
  "90+":   { label: "90 天以上", color: "#ff4d4f", severity: "error" },
};

function daysColor(d: number): string {
  if (d <= 30) return "#52c41a";
  if (d <= 60) return "#1677ff";
  if (d <= 90) return "#faad14";
  return "#ff4d4f";
}

export default function AgingPage() {
  const { isMobile } = useResponsive();
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [totalOverdueInvoices, setTotalOverdueInvoices] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token } = useToken();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/statistics/invoice-aging", { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setBuckets(j.data.buckets);
      setRows(j.data.rows);
      setTotalOverdueInvoices(typeof j.data.total === "number" ? j.data.total : j.data.rows.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalOverdue = useMemo(() => BUCKETS.reduce((s, b) => s + (buckets[b] ?? 0), 0), [buckets]);

  const kpiItems: StatItem[] = [
    { label: "应收总额", value: formatCurrency(totalOverdue), prefix: "¥", description: `共 ${totalOverdueInvoices} 张超期发票`, delta: { value: `最高风险 ${formatCurrency(buckets["90+"] ?? 0)}`, direction: (buckets["90+"] ?? 0) > 0 ? "down" : "up" } },
    ...BUCKETS.map((b) => ({
      label: BUCKET_META[b].label,
      value: formatCurrency(buckets[b] ?? 0),
      prefix: "¥",
      description: totalOverdue > 0 ? `占比 ${(((buckets[b] ?? 0) / totalOverdue) * 100).toFixed(1)}%` : "—"
    } as StatItem))
  ];

  const chartData = BUCKETS.map((b) => ({ bucket: BUCKET_META[b].label, amount: buckets[b] ?? 0, color: BUCKET_META[b].color }));
  // 移动端显示 Top N,避免大表横向溢出;N>=3 时折叠到 Top 5
  const TOP_N = isMobile ? 5 : 10;
  const visibleRows = isMobile && rows.length > TOP_N ? rows.slice(0, TOP_N) : rows;
  const chartHeight = isMobile ? 240 : 300;

  return (
    <Page>
      <PageHeader title="应收账龄分析" subtitle="按发票逾期天数分段监控回款风险，重点关注 90+ 段" />
      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={kpiItems} columns={5} loading={loading} />

          {totalOverdue > 0 ? (
            <HintBox style={{ marginTop: 16, padding: 16, display: "block" }}>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: "block" }}>账龄结构占比</Text>
              {BUCKETS.map((b) => {
                const v = buckets[b] ?? 0;
                const pct = (v / totalOverdue) * 100;
                return (
                  <div key={b} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
                      <Space>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: BUCKET_META[b].color, display: "inline-block", flexShrink: 0 }} />
                        <Text style={{ fontSize: 13 }}>{BUCKET_META[b].label}</Text>
                      </Space>
                      <Space size={12} wrap>
                        <Text style={{ fontSize: 13 }}>{pct.toFixed(1)}%</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatCurrency(v)}</Text>
                      </Space>
                    </div>
                    <Progress
                      percent={Math.round(pct)}
                      showInfo={false}
                      strokeColor={BUCKET_META[b].color}
                      size={{ height: 8 }}
                      style={{ margin: 0 }}
                    />
                  </div>
                );
              })}
            </HintBox>
          ) : null}

          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="账龄分布" />
            <ProCard>
              {chartData.some((d) => d.amount > 0) ? (
                <Column
                  data={chartData}
                  xField="bucket"
                  yField="amount"
                  height={chartHeight}
                  colorField="bucket"
                  autoFit
                  scale={{ color: { range: ["#52c41a", "#1677ff", "#faad14", "#ff4d4f"] } }}
                  label={{ text: (d: Record<string, unknown>) => formatCurrency(d.amount as number), style: { fontSize: 11 } }}
                />
              ) : (
                <EmptyState empty title="暂无数据" description="当前没有待回款发票" height="tall" />
              )}
            </ProCard>
          </div>

          <div style={{ marginTop: 32 }}>
            <PageHeader
              level="section"
              title={`超期明细（共 ${totalOverdueInvoices} 条${isMobile && totalOverdueInvoices > TOP_N ? `, 仅显示前 ${TOP_N} 条` : ""}）`}
            />
            <ProCard>
              {visibleRows.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 520 : undefined }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                        <th style={{ padding: "10px 8px" }}>发票号</th>
                        <th style={{ padding: "10px 8px" }}>客户</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>逾期天数</th>
                        <th style={{ padding: "10px 8px", textAlign: "right" }}>剩余未收</th>
                        <th style={{ padding: "10px 8px" }}>账龄段</th>
                        <th style={{ padding: "10px 8px" }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr key={r.invoiceId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "10px 8px" }}>
                            <Link href={`/invoices/${r.invoiceId}`} style={{ color: token.colorPrimary, textDecoration: "none" }}>
                              {r.invoiceNo}
                            </Link>
                          </td>
                          <td style={{ padding: "10px 8px" }}>{r.customerName}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={daysColor(r.daysOverdue)}>{r.daysOverdue} 天</Tag>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Text strong>{formatCurrency(r.remaining)}</Text>
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <Tag color={BUCKET_META[r.bucket as Bucket]?.color}>{r.bucket}</Tag>
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            {r.status ? <StatusTag status={r.status} domain="invoice" /> : <Text type="secondary">-</Text>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState empty title="暂无数据" description="当前没有待回款发票" height="tall" />
              )}
              {isMobile && rows.length > TOP_N ? (
                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <Link href="/invoices" style={{ color: token.colorPrimary, fontSize: 13 }}>
                    查看全部 {totalOverdueInvoices} 条 →
                  </Link>
                </div>
              ) : null}
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
