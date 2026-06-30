// 账龄 KPI + 4 桶结构展示 (账龄页与 Dashboard 复用)
"use client";
import { useMemo } from "react";
import { Card, Progress, Space, Typography } from "antd";
import Link from "next/link";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { formatCurrency } from "@/lib/format";
import { useT } from "@/lib/i18n";

const { Text } = Typography;

export type AgingBuckets = {
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
};

export type AgingSummaryData = {
  totalReceivable: number;
  over90Amount: number;
  over90Ratio: number;
  largestInvoice: { invoiceId: string; invoiceNo: string; remaining: number } | null;
  customerCount: number;
  ownerCount: number;
};

const BUCKET_META: Record<keyof AgingBuckets, { key: string; color: string }> = {
  "0-30": { key: "aging.bucket.0-30", color: "#52c41a" },
  "31-60": { key: "aging.bucket.31-60", color: "#1677ff" },
  "61-90": { key: "aging.bucket.61-90", color: "#faad14" },
  "90+": { key: "aging.bucket.90+", color: "#ff4d4f" }
};
const BUCKET_KEYS: (keyof AgingBuckets)[] = ["0-30", "31-60", "61-90", "90+"];

type Props = {
  buckets: AgingBuckets;
  summary: AgingSummaryData;
  basisUsed: "issue" | "due";
  invoiceCount: number;
  /** KPI 列数 (移动端 2, 桌面 5) */
  columns?: 2 | 3 | 4 | 5;
  loading?: boolean;
};

export function AgingSummary({ buckets, summary, basisUsed, invoiceCount, columns = 5, loading }: Props) {
  const t = useT();
  const total = useMemo(
    () => BUCKET_KEYS.reduce((s, k) => s + (buckets[k] ?? 0), 0),
    [buckets]
  );

  const kpiItems: StatItem[] = [
    {
      label: t("aging.kpi.total"),
      value: formatCurrency(summary.totalReceivable),
      prefix: "¥",
      description: `${invoiceCount} 张发票 / ${summary.customerCount} 个客户`,
      tooltip: basisUsed === "due" ? "按到期日计算" : "按开票日计算"
    },
    {
      label: t("aging.kpi.over90"),
      value: formatCurrency(summary.over90Amount),
      prefix: "¥",
      description: `占比 ${summary.over90Ratio.toFixed(1)}%`,
      delta: { value: summary.over90Amount > 0 ? "高风险" : "—", direction: summary.over90Amount > 0 ? "down" : "up" }
    },
    {
      label: t("aging.kpi.maxInvoice"),
      value: summary.largestInvoice ? formatCurrency(summary.largestInvoice.remaining) : "—",
      prefix: "¥",
      description: summary.largestInvoice ? (
        <Link href={`/invoices/${summary.largestInvoice.invoiceId}`} style={{ fontSize: 12 }}>
          {summary.largestInvoice.invoiceNo}
        </Link>
      ) : (
        "—"
      )
    },
    {
      label: t("aging.kpi.customerCount"),
      value: summary.customerCount,
      suffix: "家"
    },
    {
      label: t("aging.kpi.ownerCount"),
      value: summary.ownerCount,
      suffix: "人"
    }
  ];

  return (
    <>
      <StatGrid items={kpiItems} columns={columns} loading={loading} />
      {total > 0 ? (
        <Card size="small" style={{ marginTop: 16 }} styles={{ body: { padding: 16 } }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: "block" }}>
            账龄结构 (基准: {basisUsed === "due" ? "到期日" : "开票日"})
          </Text>
          {BUCKET_KEYS.map((k) => {
            const v = buckets[k] ?? 0;
            const pct = (v / total) * 100;
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
                  <Space>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: BUCKET_META[k].color,
                        display: "inline-block",
                        flexShrink: 0
                      }}
                    />
                    <Text style={{ fontSize: 13 }}>{t(BUCKET_META[k].key)}</Text>
                  </Space>
                  <Space size={12} wrap>
                    <Text style={{ fontSize: 13 }}>{pct.toFixed(1)}%</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatCurrency(v)}</Text>
                  </Space>
                </div>
                <Progress
                  percent={Math.round(pct)}
                  showInfo={false}
                  strokeColor={BUCKET_META[k].color}
                  size={{ height: 8 }}
                  style={{ margin: 0 }}
                />
              </div>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}
