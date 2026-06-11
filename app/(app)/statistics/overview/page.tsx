"use client";
import { ProCard } from "@ant-design/pro-components";
import { Button, Space, DatePicker, App as AntdApp, Typography } from "antd";
import { Line, Column, Pie } from "@ant-design/charts";
import { useCallback, useEffect, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";
import { formatStatus } from "@/lib/status";

const { Text } = Typography;

type Series = { month: string; contractAmount: number; invoiceAmount: number; paymentAmount: number }[];
type Overview = {
  contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number;
  invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number;
};
type DistItem = { key: string; count: number };
type Resp = {
  overview: Overview; series: Series;
  customers: { total: number; newThisMonth: number };
  townDistribution: { town: string | null; count: number }[];
  projects: { total: number; byStatus: { status: string; count: number }[] };
  distribution: { byScale: DistItem[]; byType: DistItem[]; byStatus: DistItem[] };
};

const CUST_STATUS_LABEL: Record<string, string> = {
  LEAD: "潜在", NEGOTIATING: "洽谈中", SIGNED: "已签约", LOST: "已流失", FROZEN: "已冻结"
};

export default function OverviewPage() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { message } = AntdApp.useApp();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (range) { qs.set("from", range[0].toISOString()); qs.set("to", range[1].toISOString()); }
      const r = await fetch(`/api/statistics/overview?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setData(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [range, load]);

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
  const cust = data?.customers;
  const proj = data?.projects;
  const dist = data?.distribution;

  const lineData = s.flatMap((x) => [
    { month: x.month, value: x.contractAmount, type: "合同额" },
    { month: x.month, value: x.invoiceAmount, type: "已开票额" },
    { month: x.month, value: x.paymentAmount, type: "已回款额" }
  ]);

  const kpis: StatItem[] = [
    { label: "客户总数", value: cust?.total ?? 0, suffix: "家", description: `${cust?.newThisMonth ?? 0} 家新增` },
    { label: "合同额", value: formatCurrency(o?.contractAmount ?? 0), prefix: "¥", description: `共 ${o?.contractCount ?? 0} 份` },
    { label: "项目数", value: proj?.total ?? 0, suffix: "个", description: `进行中 ${proj?.byStatus.find(s => s.status === "IN_PROGRESS")?.count ?? 0} 个` },
    { label: "已开票额", value: formatCurrency(o?.invoiceAmount ?? 0), prefix: "¥", description: `开票率 ${o?.invoiceRate ?? 0}%` },
    { label: "已回款额", value: formatCurrency(o?.paymentAmount ?? 0), prefix: "¥", description: `回款率 ${o?.paymentRate ?? 0}%` }
  ];

  const custDistData = dist?.byStatus.map(x => ({ type: CUST_STATUS_LABEL[x.key] ?? x.key, count: x.count })) ?? [];
  const projData = proj?.byStatus.map(x => ({ status: formatStatus(x.status, "project").label, count: x.count })) ?? [];

  return (
    <Page>
      <PageHeader
        title="统计分析"
        subtitle="客户、合同、项目、开票、回款 5 维度综合看板"
        actions={
          <Space>
            <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)} />
            <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
          </Space>
        }
      />
      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={kpis} columns={5} loading={loading && !data} />

          <div style={{ marginTop: 24 }}>
            <PageHeader level="section" title="客户区域分布" subtitle="按镇街分组" />
            <ProCard>
              {data && data.townDistribution && data.townDistribution.length > 0 ? (
                <Column data={data.townDistribution} xField="town" yField="count" height={320} colorField="town"
                  label={{ text: (d: Record<string, unknown>) => String(d.count), style: { fontSize: 11 } }}
                  xAxis={{ label: { autoRotate: true, autoHide: false } }}
                />
              ) : <EmptyState empty title="暂无区域分布数据" description="客户所在地尚未录入镇街信息" height={320} />}
            </ProCard>
          </div>

          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="项目状态" />
            <ProCard>
              {projData.length > 0 ? (
                <Column data={projData} xField="status" yField="count" height={260} colorField="status" />
              ) : <EmptyState empty title="暂无项目数据" height={260} />}
            </ProCard>
          </div>

          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="合同/开票/回款趋势" />
            <ProCard>
              {lineData.length > 0 ? (
                <Line data={lineData} xField="month" yField="value" colorField="type" height={320}
                  point={{ shapeField: "circle", sizeField: 3 }}
                />
              ) : <EmptyState empty title="暂无趋势数据" height={320} />}
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
