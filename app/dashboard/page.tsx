"use client";
import { ProCard, StatisticCard } from "@ant-design/pro-components";
import { Spin } from "antd";
import { useEffect, useState } from "react";

type Summary = {
  overview: {
    contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number;
    invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number;
  };
  distribution: { byLevel: { key: string; count: number }[]; byType: { key: string; count: number }[]; byStatus: { key: string; count: number }[] };
  agingBuckets: { "0-30": number; "31-60": number; "61-90": number; "90+": number };
};

export default function DashboardPage() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    fetch("/api/dashboard/summary", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (j.code === 0) setData(j.data); });
  }, []);
  if (!data) return <Spin />;
  return (
    <ProCard split="vertical">
      <ProCard split="vertical">
        <StatisticCard title="合同额" statistic={{ value: data.overview.contractAmount, prefix: "¥", precision: 2, description: `共 ${data.overview.contractCount} 份` }} />
        <StatisticCard title="已开票额" statistic={{ value: data.overview.invoiceAmount, prefix: "¥", precision: 2, description: `开票率 ${data.overview.invoiceRate}%` }} />
      </ProCard>
      <ProCard split="vertical">
        <StatisticCard title="已回款额" statistic={{ value: data.overview.paymentAmount, prefix: "¥", precision: 2, description: `回款率 ${data.overview.paymentRate}%` }} />
        <StatisticCard title="未回款额" statistic={{ value: data.overview.unpaidAmount, prefix: "¥", precision: 2 }} />
      </ProCard>
      <ProCard title="应收账款账龄">
        <ProCard split="vertical">
          <StatisticCard title="0-30 天" statistic={{ value: data.agingBuckets["0-30"] ?? 0, prefix: "¥", precision: 2 }} />
          <StatisticCard title="31-60 天" statistic={{ value: data.agingBuckets["31-60"] ?? 0, prefix: "¥", precision: 2 }} />
          <StatisticCard title="61-90 天" statistic={{ value: data.agingBuckets["61-90"] ?? 0, prefix: "¥", precision: 2 }} />
          <StatisticCard title="90+ 天" statistic={{ value: data.agingBuckets["90+"] ?? 0, prefix: "¥", precision: 2, valueStyle: { color: "#cf1322" } }} />
        </ProCard>
      </ProCard>
    </ProCard>
  );
}
