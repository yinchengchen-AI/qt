"use client";
import { ProCard, StatisticCard } from "@ant-design/pro-components";
import { Button, Space, DatePicker, App as AntdApp } from "antd";
import { Line, Pie, Column } from "@ant-design/charts";
import { useState, useEffect } from "react";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

type Series = { month: string; contractAmount: number; invoiceAmount: number; paymentAmount: number }[];
type Overview = {
  contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number;
  invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number;
};
type Resp = { overview: Overview; series: Series };

export default function OverviewPage() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const { message } = AntdApp.useApp();
  const load = async () => {
    const qs = new URLSearchParams();
    if (range) { qs.set("from", range[0].toISOString()); qs.set("to", range[1].toISOString()); }
    const r = await fetch(`/api/statistics/overview?${qs}`, { credentials: "include" });
    const j = await r.json();
    if (j.code === 0) setData(j.data);
  };
  useEffect(() => { load(); }, [range]);

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
  return (
    <ProCard split="vertical">
      <ProCard title="总览" extra={
        <Space>
          <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as any)} />
          <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
        </Space>
      }>
        <ProCard split="vertical">
          <StatisticCard title="合同额" statistic={{ value: o?.contractAmount ?? 0, prefix: "¥", precision: 2, description: `共 ${o?.contractCount ?? 0} 份` }} />
          <StatisticCard title="已开票额" statistic={{ value: o?.invoiceAmount ?? 0, prefix: "¥", precision: 2, description: `开票率 ${o?.invoiceRate ?? 0}%` }} />
        </ProCard>
        <ProCard split="vertical">
          <StatisticCard title="已回款额" statistic={{ value: o?.paymentAmount ?? 0, prefix: "¥", precision: 2, description: `回款率 ${o?.paymentRate ?? 0}%` }} />
          <StatisticCard title="未回款额" statistic={{ value: o?.unpaidAmount ?? 0, prefix: "¥", precision: 2 }} />
        </ProCard>
      </ProCard>
      <ProCard title="趋势">
        {lineData.length > 0 && (
          <Line
            data={lineData}
            xField="month"
            yField="value"
            colorField="type"
            height={320}
            point={{ shapeField: "circle", sizeField: 3 }}
          />
        )}
      </ProCard>
    </ProCard>
  );
}
