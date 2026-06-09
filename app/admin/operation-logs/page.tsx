"use client";
import { ProTable } from "@ant-design/pro-components";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { formatStatus } from "@/lib/status";

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

// 复用 contract/project/invoice/payment/customer 的 status palette,
// 兼容两种域("contract" / "project" / "invoice" / "payment" / "customer")的 action 前缀
function actionDomain(action: string): "contract" | "project" | "invoice" | "payment" | "customer" | null {
  if (action.startsWith("CONTRACT_")) return "contract";
  if (action.startsWith("PROJECT_")) return "project";
  if (action.startsWith("INVOICE_")) return "invoice";
  if (action.startsWith("PAYMENT_")) return "payment";
  if (action.startsWith("CUSTOMER_")) return "customer";
  return null;
}

function shortAction(action: string): string {
  // CONTRACT_SUBMIT -> SUBMIT, PAYMENT_CONFIRM -> CONFIRM
  const idx = action.indexOf("_");
  return idx >= 0 ? action.slice(idx + 1) : action;
}

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
    <Page>
      <PageHeader title="操作日志" subtitle="按时间倒序记录所有状态机迁移与关键修改" />
      <ProTable<Log>
        rowKey="id"
        loading={loading}
        search={false}
        pagination={{ pageSize: 20, total, onChange: load }}
        dataSource={rows}
        options={{ reload: () => load() }}
        cardBordered={false}
        columns={[
          { title: "时间", dataIndex: "at", width: 180, render: (v) => new Date(v as string).toLocaleString("zh-CN") },
          { title: "操作人", dataIndex: "actor", width: 160, render: (_, r) => r.actor ? `${r.actor.name}（${r.actor.employeeNo}）` : r.actorId },
          {
            title: "动作",
            dataIndex: "action",
            width: 140,
            render: (v) => {
              const action = v as string;
              const domain = actionDomain(action);
              if (domain) {
                const status = shortAction(action);
                return <StatusTag status={status} domain={domain} />;
              }
              return <span style={{ fontFamily: "var(--qt-font-mono)", fontSize: 12, color: "var(--qt-text-2)" }}>{action}</span>;
            }
          },
          { title: "对象", dataIndex: "entity", width: 100 },
          { title: "对象 ID", dataIndex: "entityId", width: 220 },
          { title: "差异", dataIndex: "diff", render: (v) => <pre style={{ margin: 0, fontSize: 12, maxWidth: 400, overflow: "auto" }}>{JSON.stringify(v, null, 2)}</pre> }
        ]}
      />
    </Page>
  );
}
