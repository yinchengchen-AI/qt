"use client";
import { ProTable } from "@ant-design/pro-components";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useListRequest } from "@/lib/use-list-request";
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

export default function OperationLogsPage() {
  const { data, total, loading, reload } = useListRequest<Log>("/api/operation-logs");

  return (
    <Page>
      <PageHeader title="操作日志" subtitle="按时间倒序记录所有状态机迁移与关键修改" />
      <ProTable<Log>
        rowKey="id"
        loading={loading}
        search={false}
        pagination={{ pageSize: 20, total, onChange: () => reload() }}
        dataSource={data}
        options={{ reload: () => reload() }}
        cardBordered={false}
        columns={[
          { title: "时间", dataIndex: "at", width: 180, render: (_, r) => <DateTimeCell value={r.at} /> },
          { title: "操作人", dataIndex: "actor", width: 160, render: (_, r) => r.actor ? `${r.actor.name}(${r.actor.employeeNo})` : r.actorId },
          {
            title: "动作",
            dataIndex: "action",
            width: 140,
            render: (_, r) => {
              const domain = actionDomain(r.action);
              if (domain) {
                return <StatusTag status={shortAction(r.action)} domain={domain} />;
              }
              return <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }}>{r.action}</span>;
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
