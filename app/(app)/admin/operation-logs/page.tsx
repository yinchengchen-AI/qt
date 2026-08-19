
"use client";
// 操作日志列表
// 改进点(相对旧版):
//   - 状态(成功/失败)、IP、对象标签列 + 对象可读名(合同号/客户名/发票号…)可点击跳详情
//   - 状态 / IP / 关键字过滤;关键字还命中对象可读名(合同号/客户名/发票号/回款号/用户名)
//   - 时间范围 RangePicker 内置预设(近 1 小时 / 近 24 小时 / 今天 / 昨天 / 近 7 天 / 近 30 天 / 本周 / 本月 / 上月 / 本年)
//   - 时间 / 动作 / 对象列头排序(默认时间倒序)
//   - entity/action/actor 过滤项由 /api/operation-logs/meta 动态生成(真实出现过的值)
//   - 系统用户(system)显示徽标;失败行悬停可见失败原因
//   - 行点击打开详情抽屉(并排 before/after 字段级 diff,字段带中文名)
//   - 当前过滤集 CSV 导出(自动翻页,上限 1000 行)
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProTable,
  type ActionType,
  type ProColumns,
  type ProFormInstance,
} from "@ant-design/pro-components";
import { App as AntdApp, Button, Space, Tag, Tooltip } from "antd";
import { DownloadOutlined, LinkOutlined, RobotOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import {
  ENTITY_LABELS,
  actionDomain,
  shortAction,
  shortActionLabel,
  entityLabel,
  fieldLabel,
} from "@/lib/operation-log-format";
import { DateTimeCell } from "@/components/table-cells";
import { SYSTEM_USER_ID } from "@/lib/system";
import { OperationLogDrawer } from "@/components/admin/operation-log-drawer";
import { formatDateTime } from "@/lib/format";

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
  entityHref: string | null;
  entityDisplay: string;
};

type Meta = {
  entities: { value: string; label: string }[];
  actions: { value: string; label: string }[];
  actors: { value: string; label: string; isSystem: boolean }[];
};

// meta 接口失败时的兜底候选(静态映射)
const FALLBACK_ENTITY_OPTIONS = Object.entries(ENTITY_LABELS).map(
  ([value, label]) => ({ value, label }),
);

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
  return {
    count: changed.length,
    sample: changed.slice(0, 3).map(fieldLabel).join(", "),
  };
}

// 时间范围 RangePicker 预设;value 用函数形式,antd 每次点击时才取当前时间,长开的页面不会用过期区间
// "本周"从周一起算(手动计算,不依赖 dayjs locale)
function buildTimeRangePresets(): {
  label: string;
  value: () => [dayjs.Dayjs, dayjs.Dayjs];
}[] {
  return [
    { label: "近 1 小时", value: () => [dayjs().subtract(1, "hour"), dayjs()] },
    { label: "近 24 小时", value: () => [dayjs().subtract(24, "hour"), dayjs()] },
    { label: "今天", value: () => [dayjs().startOf("day"), dayjs().endOf("day")] },
    {
      label: "昨天",
      value: () => [
        dayjs().subtract(1, "day").startOf("day"),
        dayjs().subtract(1, "day").endOf("day"),
      ],
    },
    {
      label: "近 7 天",
      value: () => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")],
    },
    {
      label: "近 30 天",
      value: () => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")],
    },
    {
      label: "本周",
      value: () => {
        const now = dayjs();
        return [now.subtract((now.day() + 6) % 7, "day").startOf("day"), now.endOf("day")];
      },
    },
    { label: "本月", value: () => [dayjs().startOf("month"), dayjs().endOf("day")] },
    {
      label: "上月",
      value: () => [
        dayjs().subtract(1, "month").startOf("month"),
        dayjs().subtract(1, "month").endOf("month"),
      ],
    },
    { label: "本年", value: () => [dayjs().startOf("year"), dayjs().endOf("day")] },
  ];
}

// dayjs / ISO 字符串 / Date 统一转 ISO；非法值回退 undefined
function toIso(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const d = dayjs.isDayjs(v) ? v : dayjs(v as string);
  return d.isValid() ? d.toISOString() : undefined;
}

const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 1000;

// 导出当前过滤的日志为 CSV（自动翻页,最多 EXPORT_MAX_ROWS 行）
async function exportLogsToCsv(
  baseQs: URLSearchParams,
  systemMessage: (msg: string) => void,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const all: Log[] = [];
  let total = 0;
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams(baseQs);
    qs.set("page", String(page));
    qs.set("pageSize", String(EXPORT_PAGE_SIZE));
    const res = await fetch(`/api/operation-logs?${qs}`, { credentials: "include" });
    const j = await res.json();
    if (j.code !== 0) {
      systemMessage(j.message ?? "导出失败");
      return 0;
    }
    const list = (j.data?.list ?? []) as Log[];
    total = j.data?.total ?? 0;
    all.push(...list);
    onProgress(all.length, total);
    if (list.length < EXPORT_PAGE_SIZE || all.length >= EXPORT_MAX_ROWS) break;
    page += 1;
  }
  const headers = [
    "时间",
    "结果",
    "操作人",
    "员工编号",
    "动作",
    "对象",
    "对象标识",
    "对象 ID",
    "客户端 IP",
    "请求方法",
    "请求路径",
    "请求 ID",
    "User-Agent",
    "失败原因",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = all.map((l) => [
    formatDateTime(l.at),
    l.status === "SUCCESS" ? "成功" : "失败",
    l.actor?.name ?? (l.actorId === SYSTEM_USER_ID ? "系统" : l.actorId),
    l.actor?.employeeNo ?? "",
    l.action,
    entityLabel(l.entity),
    l.entityDisplay,
    l.entityId,
    l.ip ?? "",
    l.method ?? "",
    l.path ?? "",
    l.requestId ?? "",
    l.userAgent ?? "",
    l.errorMessage ?? "",
  ]);
  const csv =
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `操作日志_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return all.length;
}

// 从搜索表单值组装查询串（表格请求与 CSV 导出共用）
function buildQuery(
  values: Record<string, unknown>,
  page: number,
  pageSize: number,
  sort?: { sortBy?: string; sortOrder?: "asc" | "desc" },
) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  if (values.entity) qs.set("entity", String(values.entity));
  if (values.action) qs.set("action", String(values.action));
  if (values.actorId) qs.set("actorId", String(values.actorId));
  if (values.ip) qs.set("ip", String(values.ip));
  if (values.status) qs.set("status", String(values.status));
  if (values.keyword) qs.set("keyword", String(values.keyword));
  const from = toIso(values.from);
  const to = toIso(values.to);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (sort?.sortBy) qs.set("sortBy", sort.sortBy);
  if (sort?.sortOrder) qs.set("sortOrder", sort.sortOrder);
  return qs;
}

// 可排序列(与后端 sortBy 白名单一致);操作人列不可排——actorId 无关联表,按 id 排序无意义
const SORTABLE_COLUMNS = new Set(["at", "action", "entity"]);

export default function OperationLogsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const formRef = useRef<ProFormInstance>(undefined);
  const { isMobile } = useResponsive();
  const { message: msgApi } = AntdApp.useApp();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const timeRangePresets = useMemo(() => buildTimeRangePresets(), []);

  // 过滤元数据:entity / action / actor 动态候选
  useEffect(() => {
    let alive = true;
    fetch("/api/operation-logs/meta", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.code === 0) setMeta(j.data as Meta);
      })
      .catch(() => {
        /* 兜底走静态候选 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const entityOptions = useMemo(
    () => meta?.entities ?? FALLBACK_ENTITY_OPTIONS,
    [meta],
  );
  const actionOptions = useMemo(
    () =>
      (meta?.actions ?? []).map((a) => ({
        value: a.value,
        label: `${shortActionLabel(a.value)} · ${a.value}`,
      })),
    [meta],
  );
  const actorOptions = useMemo(() => meta?.actors ?? [], [meta]);

  const columns: ProColumns<Log>[] = useMemo(
    () => [
      {
        title: "时间",
        dataIndex: "at",
        width: 170,
        hideInSearch: true,
        sorter: true,
        defaultSortOrder: "descend",
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
        render: (_, r) => {
          const tag = (
            <Tag
              color={r.status === "SUCCESS" ? "success" : "danger"}
              style={{ margin: 0 }}
            >
              {r.status === "SUCCESS" ? "成功" : "失败"}
            </Tag>
          );
          return r.status === "FAILURE" && r.errorMessage ? (
            <Tooltip title={r.errorMessage}>{tag}</Tooltip>
          ) : (
            tag
          );
        },
      },
      {
        title: "操作人",
        dataIndex: "actorId",
        width: 180,
        valueType: "select",
        fieldProps: {
          allowClear: true,
          showSearch: true,
          optionFilterProp: "label",
          placeholder: "选择操作人",
          options: actorOptions,
        },
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
                <span style={{ color: "var(--qt-text-faint)", marginLeft: 6, fontSize: 12 }}>
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
        sorter: true,
        valueType: "select",
        fieldProps: {
          allowClear: true,
          showSearch: true,
          optionFilterProp: "label",
          placeholder: "选择动作",
          options: actionOptions,
        },
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
        width: 240,
        sorter: true,
        valueType: "select",
        fieldProps: {
          allowClear: true,
          showSearch: true,
          optionFilterProp: "label",
          options: entityOptions,
        },
        render: (_, r) => (
          <Space size={6} wrap>
            <Tag style={{ margin: 0 }}>{r.entityLabel}</Tag>
            {r.entityHref ? (
              <a
                href={r.entityHref}
                onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 12, maxWidth: 160 }}
                title={r.entityDisplay}
              >
                <LinkOutlined /> {r.entityDisplay}
              </a>
            ) : (
              <Tooltip title={r.entityDisplay}>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--qt-text-hint)",
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "inline-block",
                    verticalAlign: "bottom",
                  }}
                >
                  {r.entityDisplay}
                </span>
              </Tooltip>
            )}
          </Space>
        ),
      },
      {
        title: "关键字",
        dataIndex: "keyword",
        hideInTable: true,
        fieldProps: { placeholder: "对象 ID / 请求路径 / 请求 ID / 失败原因" },
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
            <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
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
            <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
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
              <span style={{ color: "var(--qt-text-disabled)", fontSize: 12 }}>无字段变更</span>
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
                    color: "var(--qt-text-hint)",
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
        title: "时间范围",
        dataIndex: "atRange",
        valueType: "dateTimeRange",
        hideInTable: true,
        fieldProps: {
          presets: timeRangePresets,
        },
        search: {
          // transform 的返回值替换本字段进 params:统一由 request 读 params.from / params.to
          transform: (value) => {
            if (Array.isArray(value)) {
              return { from: toIso(value[0]), to: toIso(value[1]) };
            }
            return {};
          },
        },
      },
    ],
    [entityOptions, actionOptions, actorOptions, timeRangePresets],
  );

  return (
    <Page>
      <PageHeader
        title="操作日志"
        subtitle="按时间倒序记录所有状态机迁移与关键修改；支持按对象 / 动作 / 操作人 / IP / 状态 / 关键字 / 时间区间过滤；时间 / 动作 / 对象列可排序；点击行查看字段级 before/after 差异。"
        actions={
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={async () => {
              if (exporting) return;
              setExporting(true);
              msgApi.loading({ content: "正在导出…", key: "oplog-export", duration: 0 });
              try {
                const values = (formRef.current?.getFieldsValue() ?? {}) as Record<
                  string,
                  unknown
                >;
                // getFieldsValue 拿到的是原始表单值(未过 transform),atRange 需手动展开
                const range = Array.isArray(values.atRange)
                  ? (values.atRange as unknown[])
                  : [];
                const qs = buildQuery(
                  { ...values, from: toIso(range[0]), to: toIso(range[1]) },
                  1,
                  EXPORT_PAGE_SIZE,
                );
                const n = await exportLogsToCsv(
                  qs,
                  (m) => msgApi.error(m),
                  (done, total) => {
                    msgApi.loading({
                      content: `正在导出… ${Math.min(done, total)}/${Math.min(total, EXPORT_MAX_ROWS)}`,
                      key: "oplog-export",
                      duration: 0,
                    });
                  },
                );
                if (n > 0) {
                  msgApi.success(
                    n >= EXPORT_MAX_ROWS
                      ? `已导出前 ${n} 行(达到单次上限)`
                      : `已导出 ${n} 行`,
                  );
                }
              } catch (e) {
                msgApi.error((e as Error).message);
              } finally {
                msgApi.destroy("oplog-export");
                setExporting(false);
              }
            }}
          >
            导出 CSV
          </Button>
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
        request={async (params, sort) => {
          // ProTable sort: { at?: "ascend"|"descend", ... } — 取第一个白名单内的有效排序
          const sortEntry = Object.entries(sort ?? {}).find(
            ([k, v]) => v && SORTABLE_COLUMNS.has(k),
          );
          const qs = buildQuery(
            params as Record<string, unknown>,
            Number(params.current ?? 1),
            Number(params.pageSize ?? 20),
            sortEntry
              ? {
                  sortBy: sortEntry[0],
                  sortOrder: sortEntry[1] === "ascend" ? "asc" : "desc",
                }
              : undefined,
          );
          const res = await fetch(`/api/operation-logs?${qs}`, {
            credentials: "include",
          });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columnsState={{
          persistenceKey: "operation-logs-table-v2",
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
