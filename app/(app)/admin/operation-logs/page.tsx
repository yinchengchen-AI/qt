"use client";
// 操作日志列表
// 改进点(相对旧版):
//   - 状态(成功/失败)、IP、对象标签列
//   - 状态 / IP 过滤 + 快速时间区间
//   - 系统用户(system)显示徽标
//   - 行点击打开详情抽屉(并排 before/after 字段级 diff)
//   - 已知动作的中文标签
//   - 当前过滤集 CSV 导出
import { useMemo, useRef, useState } from "react";
import {
  ProTable,
  type ActionType,
  type ProColumns,
  type ProFormInstance,
} from "@ant-design/pro-components";
import { App as AntdApp, Button, Space, Tag, Tooltip } from "antd";
import { DownloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import {
  actionDomain,
  shortAction,
  shortActionLabel,
  entityLabel,
} from "@/lib/operation-log-format";
import { DateTimeCell } from "@/components/table-cells";
import { SYSTEM_USER_ID } from "@/lib/system";
import { OperationLogDrawer } from "@/components/admin/operation-log-drawer";

type Actor = {
  id: string;
  name: string;
  employeeNo: string;
  email: string | null;
  isSystem: boolean;
} | null;

type Log = {
  id: string;
  actorId: string;
  actor: Actor;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  method: string | null;
  path: string | null;
  status: "SUCCESS" | "FAILURE";
  errorMessage: string | null;
  at: string;
  entityLabel: string;
};

const ENTITY_OPTIONS = [
  { value: "Announcement", label: "公告" },
  { value: "Contract", label: "合同" },
  { value: "Customer", label: "客户" },
  { value: "Department", label: "部门" },
  { value: "Dictionary", label: "字典" },
  { value: "Invoice", label: "开票" },
  { value: "Payment", label: "回款" },
  { value: "Project", label: "项目" },
  { value: "Role", label: "角色" },
  { value: "User", label: "用户" },
  { value: "WorkflowTemplate", label: "工作流模板" },
];

// 把 diff 简化为 "N 字段变动" 摘要，点击行打开抽屉看明细
function diffSummary(diff: unknown): { count: number; sample: string } {
  if (!diff || typeof diff !== "object") return { count: 0, sample: "" };
  const obj = diff as { before?: unknown; after?: unknown };
  const b = (obj.before ?? {}) as Record<string, unknown>;
  const a = (obj.after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
  }
  return { count: changed.length, sample: changed.slice(0, 3).join(", ") };
}

function isoStartOf(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}
function isoEndOf(d: Date) {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();
}

// 快速时间区间:今天 / 7d / 30d / 本月 / 本年 / 全部
type QuickRange = "today" | "7d" | "30d" | "month" | "year" | "all";
const QUICK_LABELS: Record<QuickRange, string> = {
  today: "今天",
  "7d": "近 7 天",
  "30d": "近 30 天",
  month: "本月",
  year: "本年",
  all: "全部",
};
function quickRangeToFilter(r: QuickRange): {
  from?: string;
  to?: string;
} {
  if (r === "all") return {};
  const now = new Date();
  if (r === "today") return { from: isoStartOf(now), to: isoEndOf(now) };
  if (r === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: isoStartOf(d), to: isoEndOf(now) };
  }
  if (r === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return { from: isoStartOf(d), to: isoEndOf(now) };
  }
  if (r === "month") {
    return {
      from: isoStartOf(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoEndOf(now),
    };
  }
  // year
  return {
    from: isoStartOf(new Date(now.getFullYear(), 0, 1)),
    to: isoEndOf(now),
  };
}

// 导出当前过滤的日志为 CSV（按 IP / UA / entityId / requestId 全部展开）
async function exportLogsToCsv(
  baseQs: URLSearchParams,
  systemMessage: (msg: string) => void,
) {
  // 拉满 pageSize=100
  const qs = new URLSearchParams(baseQs);
  qs.set("page", "1");
  qs.set("pageSize", "100");
  const res = await fetch(`/api/operation-logs?${qs}`, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) {
    systemMessage(j.message ?? "导出失败");
    return;
  }
  const list = (j.data?.list ?? []) as Log[];
  const headers = [
    "时间",
    "结果",
    "操作人",
    "员工编号",
    "动作",
    "对象",
    "对象 ID",
    "客户端 IP",
    "请求方法",
    "请求路径",
    "请求 ID",
    "User-Agent",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = list.map((l) => [
    new Date(l.at).toLocaleString("zh-CN"),
    l.status === "SUCCESS" ? "成功" : "失败",
    l.actor?.name ?? (l.actorId === SYSTEM_USER_ID ? "系统" : l.actorId),
    l.actor?.employeeNo ?? "",
    l.action,
    entityLabel(l.entity),
    l.entityId,
    l.ip ?? "",
    l.method ?? "",
    l.path ?? "",
    l.requestId ?? "",
    l.userAgent ?? "",
  ]);
  const csv =
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `operation-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OperationLogsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const formRef = useRef<ProFormInstance>(undefined);
  const { isMobile } = useResponsive();
  const { message: msgApi } = AntdApp.useApp();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [quickRange, setQuickRange] = useState<QuickRange>("all");

  const columns: ProColumns<Log>[] = useMemo(
    () => [
      {
        title: "时间",
        dataIndex: "at",
        width: 170,
        render: (_, r) => <DateTimeCell value={r.at} />,
      },
      {
        title: "结果",
        dataIndex: "status",
        width: 80,
        valueType: "select",
        fieldProps: { allowClear: true },
        valueEnum: {
          SUCCESS: { text: "成功" },
          FAILURE: { text: "失败" },
        },
        render: (_, r) => (
          <Tag
            color={r.status === "SUCCESS" ? "success" : "danger"}
            style={{ margin: 0 }}
          >
            {r.status === "SUCCESS" ? "成功" : "失败"}
          </Tag>
        ),
      },
      {
        title: "操作人",
        dataIndex: "actorId",
        width: 180,
        fieldProps: { placeholder: "用户编号 / system" },
        render: (_, r) => {
          if (r.actorId === SYSTEM_USER_ID) {
            return (
              <Tag
                color="purple"
                icon={<RobotOutlined />}
                style={{ margin: 0 }}
              >
                系统
              </Tag>
            );
          }
          if (r.actor) {
            return (
              <span>
                {r.actor.name}
                <span style={{ color: "#999", marginLeft: 6, fontSize: 12 }}>
                  {r.actor.employeeNo}
                </span>
              </span>
            );
          }
          return (
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              {r.actorId}
            </span>
          );
        },
      },
      {
        title: "动作",
        dataIndex: "action",
        width: 160,
        fieldProps: { placeholder: "如 CONTRACT_SUBMIT" },
        render: (_, r) => {
          const domain = actionDomain(r.action);
          if (domain) {
            return (
              <Tooltip title={r.action}>
                <StatusTag status={shortAction(r.action)} domain={domain} />
              </Tooltip>
            );
          }
          return (
            <span
              style={{
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 12,
              }}
            >
              {shortActionLabel(r.action)}
            </span>
          );
        },
      },
      {
        title: "对象",
        dataIndex: "entity",
        width: 110,
        valueType: "select",
        valueEnum: ENTITY_OPTIONS.reduce<Record<string, { text: string }>>(
          (acc, o) => {
            acc[o.value] = { text: o.label };
            return acc;
          },
          {},
        ),
        fieldProps: { allowClear: true, showSearch: true },
        render: (_, r) => <Tag style={{ margin: 0 }}>{r.entityLabel}</Tag>,
      },
      {
        title: "对象 ID",
        dataIndex: "entityId",
        width: 200,
        ellipsis: true,
      },
      {
        title: "IP",
        dataIndex: "ip",
        width: 130,
        fieldProps: { placeholder: "精确或前缀" },
        render: (_, r) =>
          r.ip ? (
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              {r.ip}
            </span>
          ) : (
            <span style={{ color: "#bbb" }}>—</span>
          ),
      },
      {
        title: "请求",
        dataIndex: "method",
        width: 120,
        hideInSearch: true,
        render: (_, r) =>
          r.method && r.path ? (
            <Tooltip title={r.path}>
              <Tag color="blue" style={{ margin: 0 }}>
                {r.method}
              </Tag>
            </Tooltip>
          ) : (
            <span style={{ color: "#bbb" }}>—</span>
          ),
      },
      {
        title: "变更",
        dataIndex: "diff",
        width: 160,
        hideInSearch: true,
        render: (_, r) => {
          const { count, sample } = diffSummary(r.diff);
          if (count === 0) {
            return (
              <span style={{ color: "#bbb", fontSize: 12 }}>无字段变更</span>
            );
          }
          return (
            <Tooltip title={sample}>
              <span style={{ fontSize: 12 }}>
                <Tag color="orange" style={{ margin: 0 }}>
                  {count} 处
                </Tag>
                <span
                  style={{
                    marginLeft: 6,
                    color: "#666",
                    fontFamily: "ui-monospace, Menlo, monospace",
                  }}
                >
                  {sample.length > 18 ? sample.slice(0, 18) + "…" : sample}
                </span>
              </span>
            </Tooltip>
          );
        },
      },
      {
        title: "起始时间",
        dataIndex: "from",
        valueType: "dateTime",
        hideInTable: true,
      },
      {
        title: "截止时间",
        dataIndex: "to",
        valueType: "dateTime",
        hideInTable: true,
      },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="操作日志"
        subtitle="按时间倒序记录所有状态机迁移与关键修改；支持按对象 / 动作 / 操作人 / IP / 状态 / 时间区间过滤；点击行查看字段级 before/after 差异。"
        actions={
          <Space>
            {/* 快速时间区间 */}
            <Space.Compact>
              {(Object.keys(QUICK_LABELS) as QuickRange[]).map((r) => (
                <Button
                  key={r}
                  size={isMobile ? "small" : "middle"}
                  type={quickRange === r ? "primary" : "default"}
                  onClick={() => {
                    setQuickRange(r);
                    const f = quickRangeToFilter(r);
                    formRef.current?.setFieldsValue({
                      from: f.from,
                      to: f.to,
                    });
                    actionRef.current?.reload?.();
                  }}
                >
                  {QUICK_LABELS[r]}
                </Button>
              ))}
            </Space.Compact>
            <Button
              icon={<DownloadOutlined />}
              onClick={async () => {
                try {
                  const values = formRef.current?.getFieldsValue() ?? {};
                  const qs = new URLSearchParams();
                  qs.set("page", "1");
                  qs.set("pageSize", "100");
                  if (values.entity) qs.set("entity", String(values.entity));
                  if (values.action) qs.set("action", String(values.action));
                  if (values.actorId) qs.set("actorId", String(values.actorId));
                  if (values.entityId)
                    qs.set("entityId", String(values.entityId));
                  if (values.ip) qs.set("ip", String(values.ip));
                  if (values.status) qs.set("status", String(values.status));
                  if (values.from) qs.set("from", String(values.from));
                  if (values.to) qs.set("to", String(values.to));
                  await exportLogsToCsv(qs, (m) => msgApi.error(m));
                  msgApi.success("已导出当前过滤集");
                } catch (e) {
                  msgApi.error((e as Error).message);
                }
              }}
            >
              导出 CSV
            </Button>
          </Space>
        }
      />
      <ProTable<Log>
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        columns={columns}
        search={{
          labelWidth: "auto",
          defaultCollapsed: isMobile,
          layout: isMobile ? "vertical" : undefined,
          collapsed: isMobile ? false : undefined,
        }}
        debounceTime={400}
        scroll={{ x: "max-content" }}
        cardBordered={false}
        sticky={isMobile}
        onRow={(record) => ({
          onClick: () => setDrawerId(record.id),
          style: { cursor: "pointer" },
        })}
        options={{
          reload: () => actionRef.current?.reload?.(),
          density: !isMobile,
          fullScreen: !isMobile,
        }}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: !isMobile,
          size: isMobile ? "small" : undefined,
        }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 20));
          if (params.entity) qs.set("entity", String(params.entity));
          if (params.action) qs.set("action", String(params.action));
          if (params.actorId) qs.set("actorId", String(params.actorId));
          if (params.entityId) qs.set("entityId", String(params.entityId));
          if (params.ip) qs.set("ip", String(params.ip));
          if (params.status) qs.set("status", String(params.status));
          if (params.from) qs.set("from", String(params.from));
          if (params.to) qs.set("to", String(params.to));
          const res = await fetch(`/api/operation-logs?${qs}`, {
            credentials: "include",
          });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columnsState={{
          persistenceKey: "operation-logs-table",
          persistenceType: "localStorage",
        }}
      />
      <OperationLogDrawer
        logId={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </Page>
  );
}
