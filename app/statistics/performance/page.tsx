"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useEffect, useState } from "react";
import { Button, App as AntdApp } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

type Row = { userId: string; name: string; employeeNo: string; contractAmount: number; invoiceAmount: number; paymentAmount: number; contractCount: number };

export default function PerformancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { message } = AntdApp.useApp();
  useEffect(() => {
    fetch("/api/statistics/sales-performance", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (j.code === 0) setRows(j.data); });
  }, []);
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
    <ProCard split="vertical" extra={<Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>}>
      <ProCard title="合同额 Top">
        {chartData.length > 0 && <Column data={chartData} xField="name" yField="value" height={280} />}
      </ProCard>
      <ProCard title="明细">
        <ProTable<Row>
          rowKey="userId"
          search={false}
          options={false}
          pagination={false}
          dataSource={rows}
          columns={[
            { title: "工号", dataIndex: "employeeNo", width: 100 },
            { title: "姓名", dataIndex: "name", width: 120 },
            { title: "合同数", dataIndex: "contractCount", width: 100 },
            { title: "合同额", dataIndex: "contractAmount", width: 160, valueType: "digit" },
            { title: "已开票", dataIndex: "invoiceAmount", width: 160, valueType: "digit" },
            { title: "已回款", dataIndex: "paymentAmount", width: 160, valueType: "digit" }
          ]}
        />
      </ProCard>
    </ProCard>
  );
}
