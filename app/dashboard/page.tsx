"use client";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";

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

function currency(n: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

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
        <PageHeader title="工作台" subtitle="业务关键指标实时概览" />
        <StatGrid columns={4} loading items={[{}, {}, {}, {}] as StatItem[]} />
        <StatGrid columns={4} loading items={[{}, {}, {}, {}] as StatItem[]} />
      </Page>
    );
  }

  const { overview: o, agingBuckets: a } = data;

  const kpis: StatItem[] = [
    {
      label: "合同额",
      value: currency(o.contractAmount),
      prefix: "¥",
      description: `共 ${o.contractCount} 份合同`,
      tone: "info"
    },
    {
      label: "已开票额",
      value: currency(o.invoiceAmount),
      prefix: "¥",
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`,
      tone: "accent"
    },
    {
      label: "已回款额",
      value: currency(o.paymentAmount),
      prefix: "¥",
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`,
      tone: "success"
    },
    {
      label: "未回款额",
      value: currency(o.unpaidAmount),
      prefix: "¥",
      description: "应收账款余额",
      tone: "danger"
    }
  ];

  const aging: StatItem[] = [
    { label: "0-30 天", value: currency(a["0-30"] ?? 0), prefix: "¥", tone: "success" },
    { label: "31-60 天", value: currency(a["31-60"] ?? 0), prefix: "¥", tone: "info" },
    { label: "61-90 天", value: currency(a["61-90"] ?? 0), prefix: "¥", tone: "accent" },
    { label: "90+ 天", value: currency(a["90+"] ?? 0), prefix: "¥", tone: "danger" }
  ];

  return (
    <Page>
      <PageHeader title="工作台" subtitle="业务关键指标实时概览" />
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--qt-text-2)", margin: "0 0 10px" }}>
          核心指标
        </h2>
        <StatGrid items={kpis} columns={4} />
      </section>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--qt-text-2)", margin: "8px 0 10px" }}>
          应收账款账龄
        </h2>
        <StatGrid items={aging} columns={4} />
      </section>
    </Page>
  );
}
