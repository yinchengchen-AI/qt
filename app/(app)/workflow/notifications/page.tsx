"use client";
// P11: 工作流通知中心 — 聚合 WORKFLOW_* 消息
import useSWR from "swr";
import { useState } from "react";
import { App as AntdApp, Button, Card, Empty, Segmented, Skeleton, Space, Tag, Typography } from "antd";
import { CheckOutlined, ReadOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useRouter } from "next/navigation";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type Notification = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
};

type NotifData = {
  items: Notification[];
  byType: { type: string; count: number; unread: number }[];
  totals: { total: number; unread: number };
};

const TYPE_LABEL: Record<string, string> = {
  WORKFLOW_TASK_ASSIGNED: "任务指派",
  WORKFLOW_REVIEW_REQUESTED: "审阅请求"
};

const TYPE_COLOR: Record<string, string> = {
  WORKFLOW_TASK_ASSIGNED: "blue",
  WORKFLOW_REVIEW_REQUESTED: "purple"
};

const TYPE_ICON: Record<string, string> = {
  WORKFLOW_TASK_ASSIGNED: "📋",
  WORKFLOW_REVIEW_REQUESTED: "🔍"
};

export default function WorkflowNotificationsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { message } = AntdApp.useApp();
  const [filter, setFilter] = useState<string>("unread");
  const { data, isLoading, mutate } = useSWR<NotifData>(
    filter === "unread"
      ? "/api/workflow/notifications?unread=true&limit=200"
      : "/api/workflow/notifications?limit=200"
  );

  const handleMarkRead = async (id: string) => {
    const r = await fetch(`/api/messages/${id}`, { method: "PATCH", credentials: "include" });
    const j = await r.json();
    if (j.code !== 0) { message.error(j.message); return; }
    await mutate();
  };

  const handleMarkAll = async () => {
    const r = await fetch("/api/messages/mark-all-read", { method: "POST", credentials: "include" });
    const j = await r.json();
    if (j.code !== 0) { message.error(j.message); return; }
    message.success("已全部标为已读");
    await mutate();
  };

  const handleClick = async (n: Notification) => {
    if (!n.readAt) await handleMarkRead(n.id);
    if (n.link?.kind === "project") router.push(`/projects/${n.link.id}`);
  };

  return (
    <Page>
      <PageHeader
        title="工作流通知"
        subtitle={`聚合 WORKFLOW_TASK_ASSIGNED / WORKFLOW_REVIEW_REQUESTED 等工作流事件`}
        actions={
          <Space>
            <Text type="secondary">{data?.totals.unread ?? 0} 未读 / {data?.totals.total ?? 0} 总</Text>
            <Button icon={<ReadOutlined />} onClick={handleMarkAll} disabled={(data?.totals.unread ?? 0) === 0}>
              全部已读
            </Button>
          </Space>
        }
      />

      {isLoading || !data ? (
        <Skeleton active />
      ) : (
        <>
          <Space size={8} wrap style={{ marginBottom: 16 }}>
            {data.byType.map((b) => (
              <Card key={b.type} size="small" style={{ minWidth: 160 }}>
                <Space direction="vertical" size={0}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {TYPE_ICON[b.type]} {TYPE_LABEL[b.type] ?? b.type}
                  </Text>
                  <Text strong style={{ fontSize: 18 }}>{b.count}</Text>
                  <Text type={b.unread > 0 ? "warning" : "secondary"} style={{ fontSize: 12 }}>
                    {b.unread > 0 ? `${b.unread} 未读` : "全部已读"}
                  </Text>
                </Space>
              </Card>
            ))}
          </Space>

          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as string)}
            options={[
              { label: `未读 (${data.totals.unread})`, value: "unread" },
              { label: `全部 (${data.totals.total})`, value: "all" }
            ]}
            style={{ marginBottom: 12 }}
          />

          {data.items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={filter === "unread" ? "暂无未读工作流通知 🎉" : "暂无工作流通知"}
            />
          ) : (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {data.items.map((n) => (
                <Card
                  key={n.id}
                  size="small"
                  hoverable
                  onClick={() => handleClick(n)}
                  style={{
                    background: n.readAt ? "#fff" : "#f0f8ff",
                    borderLeft: n.readAt ? "none" : "3px solid #1677ff"
                  }}
                >
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    <Space size={6} wrap>
                      <Tag color={TYPE_COLOR[n.type] ?? "default"}>{TYPE_LABEL[n.type] ?? n.type}</Tag>
                      <Text strong>{n.title}</Text>
                      {!n.readAt && <Tag color="processing">未读</Tag>}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{n.content}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {new Date(n.createdAt).toLocaleString("zh-CN")}
                    </Text>
                  </Space>
                </Card>
              ))}
            </Space>
          )}
        </>
      )}
    </Page>
  );
}
