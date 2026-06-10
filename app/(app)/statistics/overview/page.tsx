"use client";
import { ProCard } from "@ant-design/pro-components";
import { Button, Space, DatePicker, App as AntdApp } from "antd";
import { Line } from "@ant-design/charts";
import { useState, useEffect } from "react";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

type Series = { month: string; contractAmount: number; invoiceAmount: number; paymentAmount: number }[];
type Overview = {
  contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number;
  invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number;
};
type Resp = { overview: Overview; series: Series };

export default function OverviewPage() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { message } = AntdApp.useApp();
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (range) { qs.set("from", range[0].toISOString()); qs.set("to", range[1].toISOString()); }
      const r = await fetch(`/api/statistics/overview?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setData(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const download = async () => {
    const qs = new URLSearchParams({ type: "overview" });
    if (range) { qs.set("from", range[0].toISOString()); qs.set("to", range[1].toISOString()); }
    const r = await fetch(`/api/statistics/export?${qs}`, { credentials: "include" });
    if (!r.ok) { const j = await r.json(); message.error(j.message); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `总览_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  };

  const o = data?.overview;
  const s = data?.series ?? [];
  const lineData = s.flatMap((x) => [
    { month: x.month, value: x.contractAmount, type: "合同额" },
    { month: x.month, value: x.invoiceAmount, type: "已开票额" },
    { month: x.month, value: x.paymentAmount, type: "已回款额" }
  ]);

  const kpis: StatItem[] = [
    { label: "合同额", value: formatCurrency(o?.contractAmount ?? 0), prefix: "¥", description: `共 ${o?.contractCount ?? 0} 份` },
    { label: "已开票额", value: formatCurrency(o?.invoiceAmount ?? 0), prefix: "¥", description: `开票率 ${o?.invoiceRate ?? 0}%` },
    { label: "已回款额", value: formatCurrency(o?.paymentAmount ?? 0), prefix: "¥", description: `回款率 ${o?.paymentRate ?? 0}%` },
    { label: "未回款额", value: formatCurrency(o?.unpaidAmount ?? 0), prefix: "¥", description: "应收账款余额" }
  ];

  return (
    <Page>
      <PageHeader
        title="总览"
        subtitle="按时间段汇总合同、开票、回款,观察趋势"
        actions={
          <Space>
            <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as any)} />
            <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
          </Space>
        }
      />
      {error ? (
        <EmptyState
          error={{ message: error, onRetry: load }}
          title="加载失败"
        />
      ) : (
        <>
          <StatGrid items={kpis} columns={4} loading={loading && !data} />
          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="趋势" />
            <ProCard>
              {lineData.length > 0 ? (
                <Line
                  data={lineData}
                  xField="month"
                  yField="value"
                  colorField="type"
                  height={320}
                  point={{ shapeField: "circle", sizeField: 3 }}
                />
              ) : (
                <EmptyState empty title="暂无趋势数据" description="选择时间段或检查数据库中是否存在业务记录" height="tall" />
              )}
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
