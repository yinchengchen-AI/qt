"use client";
// 合同详情"操作记录" tab 的时间线组件
// 拉取 /api/contracts/[id]/operation-logs（合同自身 + 该合同下的开票/回款 所有操作）
// 用 antd Timeline 按日期分组；点击节点打开现有 OperationLogDrawer 看 diff
import { useMemo, useState } from "react";
import {
  Timeline,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  Button,
  Alert,
} from "antd";
import { RobotOutlined, ReloadOutlined, CloseCircleFilled, CheckCircleFilled } from "@ant-design/icons";
import useSWRInfinite from "swr/infinite";
import { DateTimeCell } from "@/components/table-cells";
import { StatusTag } from "@/components/status-tag";
import { SYSTEM_USER_ID } from "@/lib/system";
import {
  actionDomain,
  shortAction,
  shortActionLabel,
  entityLabel,
} from "@/lib/operation-log-format";
import { OperationLogDrawer } from "@/components/admin/operation-log-drawer";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type Actor = {
  id: string;
  name: string;
  employeeNo: string;
  email: string | null;
  isSystem: boolean;
} | null;

export type ContractOpLog = {
  id: string;
  actorId: string;
  actor: Actor;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  status: "SUCCESS" | "FAILURE";
  errorMessage: string | null;
  at: string;
  entityLabel: string;
  entityHref: string | null;
};

type Page = {
  list: ContractOpLog[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 50;

function getKey(
  pageIndex: number,
  previousPageData: Page | null,
  contractId: string,
): string | null {
  if (previousPageData && previousPageData.list.length < PAGE_SIZE) {
    return null;
  }
  if (previousPageData && pageIndex + 1 > previousPageData.total / PAGE_SIZE) {
    return null;
  }
  const qs = new URLSearchParams({
    page: String(pageIndex + 1),
    pageSize: String(PAGE_SIZE),
  });
  return `/api/contracts/${contractId}/operation-logs?${qs}`;
}

async function fetcher(url: string): Promise<Page> {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message ?? "加载失败");
  return j.data as Page;
}

// 把扁平日志按日期分组（同一天的合并到同一个 Timeline 节点集，标题用日期）
function groupByDate(logs: ContractOpLog[]): Array<{ date: string; items: ContractOpLog[] }> {
  const map = new Map<string, ContractOpLog[]>();
  for (const l of logs) {
    const d = new Date(l.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = map.get(key) ?? [];
    arr.push(l);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({ date, items }));
}

type Props = { contractId: string };

export function OperationTimeline({ contractId }: Props) {
  const { isMobile } = useResponsive();
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const { data, size, setSize, error, isLoading, isValidating, mutate } =
    useSWRInfinite<Page>((pi, pd) => getKey(pi, pd, contractId), fetcher, {
      revalidateFirstPage: true,
      revalidateOnFocus: false,
    });

  const logs = useMemo<ContractOpLog[]>(() => {
    if (!data) return [];
    return data.flatMap((p) => p.list);
  }, [data]);

  const total = data?.[0]?.total ?? 0;
  const hasMore = (() => {
    if (!data) return false;
    const last = data[data.length - 1];
    if (!last) return false;
    if (last.list.length < PAGE_SIZE) return false;
    return logs.length < total;
  })();

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载操作记录失败"
        description={(error as Error).message}
        action={
          <Button size="small" onClick={() => void mutate()}>
            重试
          </Button>
        }
      />
    );
  }

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  if (logs.length === 0) {
    return (
      <Empty
        description="本合同暂无操作记录"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void mutate()}
        >
          刷新
        </Button>
      </Empty>
    );
  }

  const groups = groupByDate(logs);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {total} 条 · 涉及合同自身 / 开票 / 回款
        </Text>
        <Space size={4}>
          <Button
            size="small"
            icon={<ReloadOutlined spin={isValidating && !isLoading} />}
            onClick={() => void mutate()}
          >
            刷新
          </Button>
          {hasMore && (
            <Button size="small" onClick={() => void setSize(size + 1)}>
              加载更多
            </Button>
          )}
        </Space>
      </div>
      {groups.map((g) => (
        <div key={g.date} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--qt-text-hint)",
              marginBottom: 8,
              letterSpacing: 0.4,
            }}
          >
            {g.date}
          </div>
          <Timeline
            items={g.items.map((l) => ({
              color: l.status === "SUCCESS" ? "green" : "red",
              // antd 6: dot 已 deprecated, 改用 icon; 成功/失败都显式 icon 保持对称
              icon:
                l.status === "FAILURE" ? (
                  <CloseCircleFilled style={{ color: "var(--ant-color-error)" }} />
                ) : (
                  <CheckCircleFilled style={{ color: "var(--ant-color-success)" }} />
                ),
              content: <TimelineItem log={l} onOpen={setDrawerId} dense={isMobile} />,
            }))}
          />
        </div>
      ))}
      <OperationLogDrawer
        logId={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}

function TimelineItem({
  log,
  onOpen,
  dense,
}: {
  log: ContractOpLog;
  onOpen: (id: string) => void;
  dense: boolean;
}) {
  const domain = actionDomain(log.action);
  const isSystem = log.actorId === SYSTEM_USER_ID;
  const entityIsNotContract = log.entity !== "Contract";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(log.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(log.id);
        }
      }}
      style={{
        cursor: "pointer",
        padding: "4px 8px",
        marginLeft: -8,
        borderRadius: 4,
      }}
      className="qt-oplog-row"
    >
      <Space size={6} wrap style={{ width: "100%" }}>
        <DateTimeCell value={log.at} />
        {isSystem ? (
          <Tag color="purple" icon={<RobotOutlined />} style={{ margin: 0 }}>
            系统
          </Tag>
        ) : log.actor ? (
          <Text style={{ fontSize: 13 }}>
            {log.actor.name}
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
              {log.actor.employeeNo}
            </Text>
          </Text>
        ) : (
          <Text type="secondary" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
            {log.actorId}
          </Text>
        )}
        {domain ? (
          <Tooltip title={log.action}>
            <StatusTag status={shortAction(log.action)} domain={domain} />
          </Tooltip>
        ) : (
          <Text style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
            {shortActionLabel(log.action)}
          </Text>
        )}
        {entityIsNotContract && (
          <Tag style={{ margin: 0 }}>{entityLabel(log.entity)}</Tag>
        )}
        {log.status === "FAILURE" && (
          <Tag color="danger" style={{ margin: 0 }}>
            失败
            {log.errorMessage ? (
              <Tooltip title={log.errorMessage}>
                <span style={{ marginLeft: 4, fontSize: 11 }}>?</span>
              </Tooltip>
            ) : null}
          </Tag>
        )}
        {!dense && log.errorMessage && log.status === "FAILURE" && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {log.errorMessage}
          </Text>
        )}
      </Space>
    </div>
  );
}
