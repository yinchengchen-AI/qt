"use client";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { actionDomain, shortAction } from "@/lib/operation-log-format";
import { DateTimeCell } from "@/components/table-cells";

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

const ENTITY_OPTIONS = [
  { value: "Announcement", label: "公告" },
  { value: "Contract", label: "合同" },
  { value: "Customer", label: "客户" },
  { value: "Dictionary", label: "字典" },
  { value: "Invoice", label: "开票" },
  { value: "Payment", label: "回款" },
  { value: "Project", label: "项目" },
  { value: "Role", label: "角色" },
  { value: "User", label: "用户" }
];

export default function OperationLogsPage() {
  const columns: ProColumns<Log>[] = [
    { title: "时间", dataIndex: "at", width: 180, render: (_, r) => <DateTimeCell value={r.at} /> },
    {
      title: "操作人",
      dataIndex: "actorId",
      width: 200,
      fieldProps: { placeholder: "user.id" },
      render: (_, r) => (r.actor ? `${r.actor.name}(${r.actor.employeeNo})` : r.actorId)
    },
    {
      title: "动作",
      dataIndex: "action",
      width: 140,
      fieldProps: { placeholder: "如 CONTRACT_SUBMIT" },
      render: (_, r) => {
        const domain = actionDomain(r.action);
        if (domain) {
          return <StatusTag status={shortAction(r.action)} domain={domain} />;
        }
        return (
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }}>
            {r.action}
          </span>
        );
      }
    },
    { title: "对象", dataIndex: "entity", width: 100, valueType: "select",
      valueEnum: ENTITY_OPTIONS.reduce<Record<string, { text: string }>>((acc, o) => {
        acc[o.value] = { text: o.label };
        return acc;
      }, {}),
      fieldProps: { allowClear: true, showSearch: true }
    },
    { title: "对象 ID", dataIndex: "entityId", width: 220 },
    {
      title: "差异",
      dataIndex: "diff",
      render: (v) => (
        <pre style={{ margin: 0, fontSize: 12, maxWidth: 400, overflow: "auto" }}>
          {JSON.stringify(v, null, 2)}
        </pre>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title="操作日志"
        subtitle="按时间倒序记录所有状态机迁移与关键修改;支持按 entity / action / actorId 过滤"
      />
      <ProTable<Log>
        rowKey="id"
        columns={columns}
        search={{
          labelWidth: "auto",
          defaultCollapsed: false
        }}
        toolbar={{ settings: [] }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (params.entity) qs.set("entity", String(params.entity));
          if (params.action) qs.set("action", String(params.action));
          if (params.actorId) qs.set("actorId", String(params.actorId));
          const res = await fetch(`/api/operation-logs?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columnsState={{
          persistenceKey: "operation-logs-table",
          persistenceType: "localStorage"
        }}
      />
    </Page>
  );
}
