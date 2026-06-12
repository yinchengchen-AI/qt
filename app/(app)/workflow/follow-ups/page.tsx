"use client";
// P13: 跟进 360 度视图
import useSWR from "swr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App as AntdApp, Button, Card, Empty, Segmented, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type FollowUpItem = {
  id: string;
  customerId: string;
  customerName: string;
  userId: string;
  userName: string;
  followAt: string;
  method: string;
  content: string;
  nextFollowAt: string | null;
  result: string | null;
};

type FollowUpData = {
  items: FollowUpItem[];
  totals: { total: number; overdue: number; pending: number };
  byMethod: { method: string; count: number }[];
  byResult: { result: string; count: number }[];
};

const METHOD_LABEL: Record<string, string> = {
  VISIT: "上门", CALL: "电话", WECHAT: "微信", EMAIL: "邮件", OTHER: "其他"
};
const METHOD_COLOR: Record<string, string> = {
  VISIT: "blue", CALL: "green", WECHAT: "cyan", EMAIL: "purple", OTHER: "default"
};
const RESULT_LABEL: Record<string, string> = {
  INTENT: "有意向", NO_INTENT: "无意向", PENDING: "待定", SIGNED: "已签单"
};
const RESULT_COLOR: Record<string, string> = {
  INTENT: "blue", NO_INTENT: "default", PENDING: "warning", SIGNED: "success"
};

export default function FollowUpOverviewPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const [filter, setFilter] = useState<string>("all");
  const { data, isLoading } = useSWR<FollowUpData>("/api/workflow/follow-ups?limit=200");

  const columns: ColumnsType<FollowUpItem> = [
    {
      title: "客户", dataIndex: "customerName", width: 140, ellipsis: true,
      render: (v: string, r: FollowUpItem) => (
        <a onClick={() => router.push(`/customers/${r.customerId}`)}>{v}</a>
      )
    },
    { title: "跟进人", dataIndex: "userName", width: 80 },
    { title: "时间", dataIndex: "followAt", width: 150,
      render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    { title: "方式", dataIndex: "method", width: 80,
      render: (v: string) => <Tag color={METHOD_COLOR[v]}>{METHOD_LABEL[v] ?? v}</Tag> },
    { title: "结果", dataIndex: "result", width: 80,
      render: (v: string | null) => v ? <Tag color={RESULT_COLOR[v]}>{RESULT_LABEL[v] ?? v}</Tag> : <Text type="secondary">-</Text> },
    { title: "内容", dataIndex: "content", ellipsis: true }
  ];

  return (
    <Page>
      <PageHeader
        title="跟进 360"
        subtitle={`最近 180 天跟进 $\{data?.totals.total ?? 0} 条记录 $\{data?.totals.overdue ?? 0} 逾期`}
        actions={
          <Space>
            {data && data.totals.overdue > 0 && (
              <Tag icon={<ClockCircleOutlined />} color="error">{data.totals.overdue} 逾期</Tag>
            )}
          </Space>
        }
      />
      {isLoading || !data ? (
        <Skeleton active />
      ) : (
        <>
          <Space size={8} wrap style={{ marginBottom: 16 }}>
            {data.byMethod.map((m) => (
              <Card key={m.method} size="small" style={{ minWidth: 120 }}>
                <Space direction="vertical" size={0}>
                  <Tag color={METHOD_COLOR[m.method]}>{METHOD_LABEL[m.method] ?? m.method}</Tag>
                  <Text strong style={{ fontSize: 18 }}>{m.count}</Text>
                </Space>
              </Card>
            ))}
          </Space>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as string)}
            options={[
              { label: `全部 (${data.totals.total})`, value: "all" },
              ...data.byResult.map((r) => ({
                label: `${RESULT_LABEL[r.result] ?? r.result} (${r.count})`,
                value: r.result
              }))
            ]}
            style={{ marginBottom: 12 }}
          />
          {data.items.length === 0 ? (
            <Empty description="暂无跟进记录" style={{ marginTop: 40 }} />
          ) : (
            <Table
              rowKey="id" columns={columns} dataSource={data.items}
              size={isMobile ? "small" : "middle"}
              pagination={{ pageSize: 20, showSizeChanger: false }}
            />
          )}
        </>
      )}
    </Page>
  );
}
