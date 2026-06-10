"use client";
import { useEffect, useState } from "react";
import { Progress, Space, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { formatCompact, formatCurrency } from "@/lib/format";

const { Text } = Typography;

type Summary = {
  overview: {
    contractAmount: number;
    invoiceAmount: number;
    paymentAmount: number;
    unpaidAmount: number;
    invoiceRate: number;
    paymentRate: number;
    contractCount: number;
    invoiceCount: number;
    paymentCount: number;
  };
  distribution: {
    byLevel: { key: string; count: number }[];
    byType: { key: string; count: number }[];
    byStatus: { key: string; count: number }[];
  };
  agingBuckets: { "0-30": number; "31-60": number; "61-90": number; "90+": number };
};

const AGING_COLOR: Record<string, string> = {
  "0-30": "#52c41a",
  "31-60": "#1677ff",
  "61-90": "#faad14",
  "90+": "#ff4d4f"
};

const AGING_LABEL: Record<string, string> = {
  "0-30": "0 — 30 天",
  "31-60": "31 — 60 天",
  "61-90": "61 — 90 天",
  "90+": "90 天以上"
};

export default function DashboardPage() {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/summary", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j.code === 0) setData(j.data);
      });
  }, []);

  if (!data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="核心经营指标的实时快照 — 合同、开票、回款、应收账龄。" />
        <StatGrid columns={4} loading items={[{}, {}, {}, {}] as StatItem[]} />
        <div style={{ height: 16 }} />
        <StatGrid columns={4} loading items={[{}, {}, {}, {}] as StatItem[]} />
      </Page>
    );
  }

  const { overview: o, agingBuckets: a } = data;

  const kpis: StatItem[] = [
    {
      label: "合同总额",
      value: formatCompact(o.contractAmount),
      description: `完整数值 ¥${formatCurrency(o.contractAmount).replace("¥", "")} · 共 ${o.contractCount} 份合同`
    },
    {
      label: "已开票额",
      value: formatCompact(o.invoiceAmount),
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`
    },
    {
      label: "已回款额",
      value: formatCompact(o.paymentAmount),
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`
    },
    {
      label: "未回款额",
      value: formatCompact(o.unpaidAmount),
      description: "应收账款余额"
    }
  ];

  const totalAging = (a["0-30"] ?? 0) + (a["31-60"] ?? 0) + (a["61-90"] ?? 0) + (a["90+"] ?? 0);
  const agingKeys = ["0-30", "31-60", "61-90", "90+"] as const;

  return (
    <Page>
      <PageHeader
        title="业务总览"
        subtitle="核心经营指标的实时快照 — 合同、开票、回款、应收账龄。"
        actions={
          <a
            href="/statistics/overview"
            style={{
              fontSize: 13,
              color: "#1677ff",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              transition: "opacity 160ms"
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.72")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            深入统计 <ArrowRightOutlined style={{ fontSize: 11 }} />
          </a>
        }
      />

      <section style={{ marginBottom: 24 }}>
        <StatGrid items={kpis} columns={4} />
      </section>

      <section>
        <PageHeader level="section" title="应收账款账龄" />
        <StatGrid
          items={agingKeys.map((k) => ({
            label: AGING_LABEL[k],
            value: formatCurrency(a[k] ?? 0).replace("¥", ""),
            prefix: "¥",
            description:
              totalAging > 0
                ? `占比 ${(((a[k] ?? 0) / totalAging) * 100).toFixed(1)}%`
                : "—"
          }))}
          columns={4}
        />

        {totalAging > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            {agingKeys.map((k) => {
              const v = a[k] ?? 0;
              const pct = (v / totalAging) * 100;
              return (
                <div key={k}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                      fontSize: 12
                    }}
                  >
                    <Text type="secondary">{AGING_LABEL[k]}</Text>
                    <Text type="secondary">
                      {pct.toFixed(1)}% · ¥{formatCurrency(v).replace("¥", "")}
                    </Text>
                  </div>
                  <Progress
                    percent={Number(pct.toFixed(1))}
                    showInfo={false}
                    strokeColor={AGING_COLOR[k]}
                    size="small"
                  />
                </div>
              );
            })}
          </Space>
        ) : null}
      </section>

      <div
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: "1px solid #f0f0f0",
          fontSize: 12,
          color: "rgba(0, 0, 0, 0.45)"
        }}
      >
        数据每分钟自动刷新 · 截止 {new Date().toLocaleString("zh-CN")}
      </div>
    </Page>
  );
}
