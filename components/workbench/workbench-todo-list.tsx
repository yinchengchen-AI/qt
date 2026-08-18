"use client";
import Link from "next/link";
import { List, Space, Tag, Typography } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { EmptyState } from "@/components/empty-state";
import type { TodoItem } from "@/server/services/contract/workbench";

const { Text } = Typography;

const TYPE_META: Record<TodoItem["type"], { color: string; label: string }> = {
  overdue: { color: "red", label: "逾期" },
  expiring: { color: "orange", label: "即将到期" },
  no_invoice: { color: "gold", label: "未开票" }
};

type Props = {
  todos: TodoItem[];
  loading?: boolean;
};

/** 工作台待办列表: 按优先级排序 (逾期 > 7 天内到期 > 未开票), 空态用 EmptyState */
export function WorkbenchTodoList({ todos, loading }: Props) {
  if (loading) {
    return <EmptyState loading title="加载待办中…" height="small" />;
  }
  if (todos.length === 0) {
    return <EmptyState empty title="暂无待办" description="需要您跟进的合同事项会出现在这里" height="small" />;
  }
  return (
    <List
      size="small"
      dataSource={todos}
      renderItem={(t) => {
        const meta = TYPE_META[t.type];
        return (
          <List.Item
            actions={[
              <Link key="go" href={t.href} style={{ fontSize: 13, color: "#1677ff" }}>
                查看 <RightOutlined style={{ fontSize: 10 }} />
              </Link>
            ]}
          >
            <Space size={8} wrap>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                {meta.label}
              </Tag>
              <Link href={t.href} style={{ fontWeight: 600 }}>
                {t.contractNo}
              </Link>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t.customerName ?? "—"} · {t.title}
              </Text>
              <Text style={{ fontSize: 12, color: meta.color === "red" ? "#ff4d4f" : "rgba(0,0,0,0.65)" }}>
                {t.dueLabel}
              </Text>
            </Space>
          </List.Item>
        );
      }}
    />
  );
}
