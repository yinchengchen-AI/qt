
"use client";
// 单条 OperationLog 详情抽屉：
//   - 顶部元数据：时间 / 操作人 / 动作 / 状态 / IP / UA / 请求 ID / method / path / 失败原因
//   - 中部对象信息：entity + entityId，可点击跳详情
//   - 底部 diff：before/after 字段级并排展示，标黄 = 新增、标红 = 删除、灰 = 未变
import {
  Drawer,
  Typography,
  Tag,
  Space,
  Descriptions,
  Skeleton,
  App as AntdApp,
  Empty,
} from "antd";
import { LinkOutlined, RobotOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useResponsive } from "@/lib/use-breakpoint";
import {
  actionDomain,
  shortAction,
  shortActionLabel,
} from "@/lib/operation-log-format";
import { StatusTag } from "@/components/status-tag";
import { SYSTEM_USER_ID } from "@/lib/system";
import { formatDateTime } from "@/lib/format";

const { Text, Paragraph } = Typography;

export type OperationLogDetail = {
  id: string;
  actorId: string;
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
  actor: {
    id: string;
    name: string;
    employeeNo: string;
    email: string | null;
    isSystem: boolean;
  } | null;
  entityLabel: string;
  entityHref: string | null;
  entityDisplay: string;
};

type Props = {
  logId: string | null;
  onClose: () => void;
};

async function fetchDetail(logId: string): Promise<OperationLogDetail> {
  const res = await fetch(`/api/operation-logs/${logId}`, {
    credentials: "include",
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message ?? "加载失败，请稍后重试");
  return j.data as OperationLogDetail;
}

export function OperationLogDrawer({ logId, onClose }: Props) {
  const { isMobile } = useResponsive();
  const { message: msgApi } = AntdApp.useApp();
  const [data, setData] = useState<OperationLogDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!logId) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchDetail(logId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: Error) => {
        if (alive) msgApi.error(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [logId, msgApi]);

  return (
    <Drawer
      open={!!logId}
      onClose={onClose}
      title={data ? `操作日志 · ${shortActionLabel(data.action)}` : "操作日志"}
      placement={isMobile ? "bottom" : "right"}
      styles={{
        wrapper: isMobile
          ? { height: "92%", width: "100%" }
          : { width: 720 },
      }}
      destroyOnHidden
    >
      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : data ? (
        <DetailBody data={data} />
      ) : (
        <Empty description="暂无数据" />
      )}
    </Drawer>
  );
}

function DetailBody({ data }: { data: OperationLogDetail }) {
  const isSystem = data.actorId === SYSTEM_USER_ID;
  const domain = actionDomain(data.action);
  const diff = parseDiff(data.diff);
  const { isMobile: isM } = useResponsive();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 顶部核心字段 */}
      <Descriptions
        size="small"
        column={isM ? 1 : 2}
        bordered
        items={[
          {
            key: "at",
            label: "时间",
            children: (
              <Text style={{ fontFeatureSettings: '"tnum"' }}>
                {formatDateTime(data.at)}
              </Text>
            ),
          },
          {
            key: "status",
            label: "结果",
            children: (
              <Tag
                color={data.status === "SUCCESS" ? "success" : "danger"}
                style={{ margin: 0 }}
              >
                {data.status === "SUCCESS" ? "成功" : "失败"}
              </Tag>
            ),
          },
          {
            key: "actor",
            label: "操作人",
            children: isSystem ? (
              <Space size={4}>
                <Tag color="purple" icon={<RobotOutlined />} style={{ margin: 0 }}>
                  系统
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {SYSTEM_USER_ID}
                </Text>
              </Space>
            ) : data.actor ? (
              <Space size={6} wrap>
                <Text>{data.actor.name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.actor.employeeNo}
                </Text>
              </Space>
            ) : (
              <Text type="secondary">{data.actorId}</Text>
            ),
          },
          {
            key: "action",
            label: "动作",
            children: domain ? (
              <StatusTag status={shortAction(data.action)} domain={domain} />
            ) : (
              <Text style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                {data.action}
              </Text>
            ),
          },
          {
            key: "entity",
            label: "对象",
            children: (
              <Space size={6} wrap>
                <Tag style={{ margin: 0 }}>{data.entityLabel}</Tag>
                {data.entityHref ? (
                  <a
                    href={data.entityHref}
                    style={{ fontSize: 12, maxWidth: 320 }}
                    title={data.entityDisplay}
                  >
                    <LinkOutlined /> {data.entityDisplay}
                  </a>
                ) : (
                  <Text
                    style={{ fontSize: 12, maxWidth: 320 }}
                    ellipsis={{ tooltip: data.entityDisplay }}
                  >
                    {data.entityDisplay}
                  </Text>
                )}
              </Space>
            ),
            span: 2,
          },
          {
            key: "ip",
            label: "客户端 IP",
            children: data.ip ? (
              <Text style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                {data.ip}
              </Text>
            ) : (
              <Text type="secondary">—</Text>
            ),
          },
          {
            key: "req",
            label: "请求",
            children: data.method && data.path ? (
              <Space size={4} wrap>
                <Tag color="blue" style={{ margin: 0 }}>
                  {data.method}
                </Tag>
                <Text
                  style={{
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 12,
                    wordBreak: "break-all",
                  }}
                >
                  {data.path}
                </Text>
              </Space>
            ) : (
              <Text type="secondary">—</Text>
            ),
          },
          {
            key: "ua",
            label: "User-Agent",
            children: data.userAgent ? (
              <Paragraph
                type="secondary"
                style={{
                  margin: 0,
                  fontSize: 12,
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                }}
              >
                {data.userAgent}
              </Paragraph>
            ) : (
              <Text type="secondary">—</Text>
            ),
            span: 2,
          },
          {
            key: "rid",
            label: "请求 ID",
            children: data.requestId ? (
              <Text
                style={{
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 12,
                }}
              >
                {data.requestId}
              </Text>
            ) : (
              <Text type="secondary">—</Text>
            ),
          },
          ...(data.errorMessage
            ? [
                {
                  key: "err",
                  label: "失败原因",
                  children: (
                    <Text type="danger">{data.errorMessage}</Text>
                  ),
                  span: 2,
                },
              ]
            : []),
        ]}
      />

      {/* 字段级 diff */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Text strong>变更明细</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {diff.length === 0
              ? "无 diff 数据"
              : `共 ${diff.length} 个字段${diff.some((d) => d.kind === "modified") ? "，含修改" : ""}`}
          </Text>
        </div>
        {diff.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="无字段变更（仅记录动作）"
          />
        ) : (
          <DiffView diff={diff} />
        )}
      </div>
    </div>
  );
}

// =====================================================
// diff helpers
// =====================================================
type DiffRow = {
  key: string;
  kind: "added" | "removed" | "modified" | "unchanged";
  before?: unknown;
  after?: unknown;
};

function parseDiff(diff: unknown): DiffRow[] {
  if (!diff || typeof diff !== "object") return [];
  const obj = diff as { before?: unknown; after?: unknown };
  const before = (obj.before ?? {}) as Record<string, unknown>;
  const after = (obj.after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: DiffRow[] = [];
  for (const k of Array.from(keys).sort()) {
    const b = before[k];
    const a = after[k];
    if (b === undefined && a !== undefined) {
      rows.push({ key: k, kind: "added", after: a });
    } else if (a === undefined && b !== undefined) {
      rows.push({ key: k, kind: "removed", before: b });
    } else if (deepEq(b, a)) {
      rows.push({ key: k, kind: "unchanged", before: b, after: a });
    } else {
      rows.push({ key: k, kind: "modified", before: b, after: a });
    }
  }
  // 未变更的字段折叠起来：仅在修改过的字段 ≤ 6 时展示全量；否则只展示变化项
  const modifiedCount = rows.filter((r) => r.kind !== "unchanged").length;
  if (modifiedCount > 6) {
    return rows.filter((r) => r.kind !== "unchanged");
  }
  return rows;
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function formatVal(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "(空串)" : v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const KIND_BG: Record<DiffRow["kind"], string> = {
  added: "#f6ffed",
  removed: "#fff1f0",
  modified: "#fffbe6",
  unchanged: "#fafafa",
};

const KIND_LABEL: Record<DiffRow["kind"], string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "未变",
};

const KIND_COLOR: Record<DiffRow["kind"], string> = {
  added: "green",
  removed: "red",
  modified: "orange",
  unchanged: "default",
};

function DiffView({ diff }: { diff: DiffRow[] }) {
  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 12,
      }}
    >
      {diff.map((row, idx) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "140px 90px 1fr",
            background: KIND_BG[row.kind],
            borderTop: idx === 0 ? "none" : "1px solid #f0f0f0",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderRight: "1px solid #f0f0f0",
              fontFamily: "ui-monospace, Menlo, monospace",
              wordBreak: "break-all",
              color: "#333",
            }}
          >
            {row.key}
          </div>
          <div
            style={{
              padding: "8px 12px",
              borderRight: "1px solid #f0f0f0",
              display: "flex",
              alignItems: "flex-start",
            }}
          >
            <Tag color={KIND_COLOR[row.kind]} style={{ margin: 0 }}>
              {KIND_LABEL[row.kind]}
            </Tag>
          </div>
          <div
            style={{
              padding: "8px 12px",
              fontFamily: "ui-monospace, Menlo, monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color: "#444",
            }}
          >
            {row.kind === "added" && <span>{formatVal(row.after)}</span>}
            {row.kind === "removed" && <span>{formatVal(row.before)}</span>}
            {row.kind === "unchanged" && <span>{formatVal(row.before)}</span>}
            {row.kind === "modified" && (
              <div>
                <div style={{ color: "#cf1322" }}>
                  <span style={{ opacity: 0.5 }}>- </span>
                  {formatVal(row.before)}
                </div>
                <div style={{ color: "#389e0d" }}>
                  <span style={{ opacity: 0.5 }}>+ </span>
                  {formatVal(row.after)}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

