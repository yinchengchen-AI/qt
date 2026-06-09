"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";

type Bucket = "0-30" | "31-60" | "61-90" | "90+";
type AgingRow = {
  invoiceId: string; invoiceNo: string; customerName: string;
  daysOverdue: number; remaining: number; bucket: Bucket; status?: string;
};

const BUCKET_TONE: Record<Bucket, StatItem["tone"]> = {
  "0-30": "success",
  "31-60": "info",
  "61-90": "accent",
  "90+": "danger"
};

function currency(n: number) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function AgingPage() {
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    fetch("/api/statistics/invoice-aging", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j.code !== 0) throw new Error(j.message);
        setBuckets(j.data.buckets);
        setRows(j.data.rows);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const items: StatItem[] = (["0-30", "31-60", "61-90", "90+"] as Bucket[]).map((b) => ({
    label: `${b} 天`,
    value: currency(buckets[b] ?? 0),
    prefix: "¥",
    tone: BUCKET_TONE[b]
  }));

  const data = (Object.keys(buckets) as Bucket[]).map((b) => ({ bucket: `${b} 天`, amount: buckets[b] ?? 0 }));

  return (
    <Page>
      <PageHeader title="账龄分析" subtitle="按未收回发票距今的天数分段,优先关注 90+ 段" />
      {error ? (
        <EmptyState error={{ message: error, onRetry: () => location.reload() }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={items} columns={4} loading={loading} />
          <ProCard title="应收账款账龄分布">
            {data.some((d) => d.amount > 0) ? (
              <Column data={data} xField="bucket" yField="amount" height={280} colorField="bucket" />
            ) : (
              <EmptyState empty title="暂无数据" description="当前没有待回款发票" height="tall" />
            )}
          </ProCard>
          <ProCard title="超期明细（前 100）">
            <ProTable<AgingRow>
              rowKey="invoiceId"
              search={false}
              options={false}
              pagination={{ pageSize: 20 }}
              dataSource={rows}
              loading={loading}
              columns={[
                { title: "发票号", dataIndex: "invoiceNo", width: 200 },
                { title: "客户", dataIndex: "customerName", width: 200 },
                { title: "账龄（天）", dataIndex: "daysOverdue", width: 100 },
                { title: "剩余未收", dataIndex: "remaining", width: 140, render: (v: any) => `¥${v}` },
                { title: "账龄段", dataIndex: "bucket", width: 100 },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 110,
                  render: (_, r) => r.status ? <StatusTag status={r.status} domain="invoice" /> : "-"
                }
              ]}
            />
          </ProCard>
        </>
      )}
    </Page>
  );
}
