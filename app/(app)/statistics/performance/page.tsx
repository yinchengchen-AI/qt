"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useEffect, useState } from "react";
import { Button, App as AntdApp } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";
import { CurrencyCell } from "@/components/table-cells";

type Row = {
  userId: string; name: string; employeeNo: string;
  contractAmount: number; invoiceAmount: number; paymentAmount: number; contractCount: number;
};

export default function PerformancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { message } = AntdApp.useApp();
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/statistics/sales-performance", { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const download = async () => {
    const r = await fetch("/api/statistics/export?type=sales-performance", { credentials: "include" });
    if (!r.ok) { const j = await r.json(); message.error(j.message); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `业务员业绩_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  };

  const chartData = rows.map((r) => ({ name: r.name, value: r.contractAmount }));

  return (
    <Page>
      <PageHeader
        title="业务员业绩"
        subtitle="按业务员工号汇总合同、开票、回款金额"
        actions={
          <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
        }
      />
      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <div>
            <PageHeader level="section" title="合同额 Top" />
            <ProCard>
              {chartData.length > 0 ? (
                <Column data={chartData} xField="name" yField="value" height={280} />
              ) : (
                <EmptyState empty title="暂无业绩数据" height="tall" />
              )}
            </ProCard>
          </div>
          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="明细" />
            <ProCard>
              <ProTable<Row>
                rowKey="userId"
                search={false}
                options={false}
                pagination={false}
                dataSource={rows}
                loading={loading}
                columns={[
                  { title: "工号", dataIndex: "employeeNo", width: 100 },
                  { title: "姓名", dataIndex: "name", width: 120 },
                  { title: "合同数", dataIndex: "contractCount", width: 100 },
                  { title: "合同额", dataIndex: "contractAmount", width: 160, render: (_, r) => <CurrencyCell value={r.contractAmount} /> },
                  { title: "已开票", dataIndex: "invoiceAmount", width: 160, render: (_, r) => <CurrencyCell value={r.invoiceAmount} /> },
                  { title: "已回款", dataIndex: "paymentAmount", width: 160, render: (_, r) => <CurrencyCell value={r.paymentAmount} /> }
                ]}
              />
            </ProCard>
          </div>
        </>
      )}
    </Page>
  );
}
