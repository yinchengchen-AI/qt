"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Tag, Space, Button } from "antd";
import { useEffect, useState } from "react";

type Log = {
  id: string;
  actorId: string;
  actor: { name: string; employeeNo: string } | null;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  at: string;
  ip: string | null;
};

const ACTION_COLORS: Record<string, string> = {
  CONTRACT_SUBMIT: "blue",
  CONTRACT_APPROVE: "green",
  CONTRACT_REJECT: "red",
  CONTRACT_WITHDRAW: "orange",
  INVOICE_SUBMIT: "blue",
  INVOICE_ISSUE: "green",
  INVOICE_REJECT: "red",
  INVOICE_VOID: "red",
  INVOICE_RED_FLUSH: "volcano",
  PAYMENT_CONFIRM: "green",
  PAYMENT_RECONCILE: "green",
  PAYMENT_REFUND: "orange",
  PAYMENT_CANCEL: "default",
  CUSTOMER_SOFT_DELETE: "red"
};

export default function OperationLogsPage() {
  const [rows, setRows] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async (page = 1, pageSize = 20) => {
    setLoading(true);
    const r = await fetch(`/api/operation-logs?page=${page}&pageSize=${pageSize}`, { credentials: "include" });
    const j = await r.json();
    if (j.code === 0) { setRows(j.data.list); setTotal(j.data.total); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <ProCard>
      <ProTable<Log>
        rowKey="id"
        headerTitle="操作日志"
        search={false}
        loading={loading}
        pagination={{ pageSize: 20, total, onChange: load }}
        dataSource={rows}
        options={{ reload: () => load() }}
        columns={[
          {
            title: "时间",
            dataIndex: "at",
            width: 180,
            render: (v) => new Date(v as string).toLocaleString("zh-CN")
          },
          {
            title: "操作人",
            dataIndex: "actor",
            width: 140,
            render: (_, r) => r.actor ? `${r.actor.name}（${r.actor.employeeNo}）` : r.actorId
          },
          {
            title: "动作",
            dataIndex: "action",
            width: 200,
            render: (v) => <Tag color={ACTION_COLORS[v as string] ?? "default"}>{v as string}</Tag>
          },
          {
            title: "对象",
            dataIndex: "entity",
            width: 100
          },
          {
            title: "对象 ID",
            dataIndex: "entityId",
            width: 220
          },
          {
            title: "差异",
            dataIndex: "diff",
            render: (v) => <pre style={{ margin: 0, fontSize: 12, maxWidth: 400, overflow: "auto" }}>{JSON.stringify(v, null, 2)}</pre>
          }
        ]}
      />
    </ProCard>
  );
}
