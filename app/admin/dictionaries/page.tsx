"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { useEffect, useState } from "react";

type Dict = { code: string; label: string };

export default function DictionariesPage() {
  const [rows, setRows] = useState<{ category: string; code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all(
      ["CUSTOMER_TYPE", "CUSTOMER_LEVEL", "SERVICE_TYPE", "CONTRACT_PAYMENT_METHOD", "PROJECT_STATUS", "INVOICE_TYPE", "PAYMENT_RECEIVE_METHOD", "CUSTOMER_STATUS", "CONTRACT_STATUS", "INVOICE_STATUS", "PAYMENT_STATUS", "FOLLOW_METHOD", "FOLLOW_RESULT", "REVIEW_ACTION"]
        .map((c) => fetch(`/api/dictionaries?category=${c}`, { credentials: "include" }).then((r) => r.json()).then((j) => ({ category: c, list: (j.data ?? []) as Dict[] })))
    ).then((groups) => {
      const all: { category: string; code: string; label: string }[] = [];
      for (const g of groups) for (const d of g.list) all.push({ category: g.category, ...d });
      setRows(all);
      setLoading(false);
    });
  }, []);

  return (
    <ProCard>
      <ProTable
        rowKey={(r) => `${r.category}-${r.code}`}
        headerTitle="数据字典"
        loading={loading}
        search={false}
        options={false}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "分类", dataIndex: "category", width: 200 },
          { title: "代码", dataIndex: "code", width: 200 },
          { title: "标签", dataIndex: "label" }
        ]}
      />
    </ProCard>
  );
}
