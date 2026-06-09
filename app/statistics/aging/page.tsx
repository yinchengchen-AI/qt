"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useEffect, useState } from "react";

type Bucket = "0-30" | "31-60" | "61-90" | "90+";
type AgingRow = { invoiceId: string; invoiceNo: string; customerName: string; daysOverdue: number; remaining: number; bucket: Bucket };

export default function AgingPage() {
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<AgingRow[]>([]);
  useEffect(() => {
    fetch("/api/statistics/invoice-aging", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (j.code === 0) { setBuckets(j.data.buckets); setRows(j.data.rows); } });
  }, []);
  const data = (Object.keys(buckets) as Bucket[]).map((b) => ({ bucket: b, amount: buckets[b] }));
  return (
    <ProCard split="vertical">
      <ProCard title="应收账款账龄分布">
        {data.some((d) => (d.amount ?? 0) > 0) && (
          <Column data={data} xField="bucket" yField="amount" height={280} colorField="bucket" />
        )}
      </ProCard>
      <ProCard title="超期明细（前 100）">
        <ProTable<AgingRow>
          rowKey="invoiceId"
          search={false}
          options={false}
          pagination={{ pageSize: 20 }}
          dataSource={rows}
          columns={[
            { title: "发票号", dataIndex: "invoiceNo", width: 200 },
            { title: "客户", dataIndex: "customerName", width: 200 },
            { title: "账龄（天）", dataIndex: "daysOverdue", width: 100 },
            { title: "剩余未收", dataIndex: "remaining", width: 140, valueType: "digit" },
            { title: "账龄段", dataIndex: "bucket", width: 100 }
          ]}
        />
      </ProCard>
    </ProCard>
  );
}
