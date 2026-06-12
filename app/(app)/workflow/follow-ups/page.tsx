"use client";
// P13: 跟进 360 度视图 — 聚合/筛选/逾期
import useSWR from "swr";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, Empty, Segmented, Select, Skeleton, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ClockCircleOutlined, PhoneOutlined, MailOutlined, WechatOutlined, EnvironmentOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text, Paragraph } = Typography;

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
const METHOD_ICON: Record<string, React.ReactNode> = {
  VISIT: <EnvironmentOutlined />, CALL: <PhoneOutlined />, WECHAT: <WechatOutlined />, EMAIL: <MailOutlined />
};
const RESULT_LABEL: Record<string, string> = {
  INTENT: "有意向", NO_INTENT: "无意向", PENDING: "待定", SIGNED: "已签单"
};
const RESULT_COLOR: Record<string, string> = {
  INTENT: "blue", NO_INTENT: "default", PENDING: "warning", SIGNED: "success"
};

const DAY_OPTIONS = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 },
  { label: "180 天", value: 180 }
];

export default function FollowUpOverviewPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const [days, setDays] = useState<number>(30);
  const [methodFilter, setMethodFilter] = useState<string | undefined>(undefined);
  const [resultFilter, setResultFilter] = useState<string>("all");

  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("days", String(days));
    p.set("limit", "300");
    if (methodFilter) p.set("method", methodFilter);
    if (resultFilter !== "all") p.set("result", resultFilter);
    return p.toString();
  }, [days, methodFilter, resultFilter]);

  const { data, isLoading } = useSWR<FollowUpData>(`/api/workflow/follow-ups?${apiParams}`);

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
      render: (v: string) => (
        <Tag icon={METHOD_ICON[v]} color={METHOD_COLOR[v]}>{METHOD_LABEL[v] ?? v}</Tag>
      ) },
    { title: "结果", dataIndex: "result", width: 80,
      render: (v: string | null) => v ? <Tag color={RESULT_COLOR[v]}>{RESULT_LABEL[v] ?? v}</Tag> : <Text type="secondary">-</Text> },
    {
      title: "下次跟进", dataIndex: "nextFollowAt", width: 150,
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">-</Text>;
        const d = new Date(v);
        const overdue = d < new Date();
        return (
          <span>
            <Text style={{ color: overdue ? "#ff4d4f" : undefined }}>
              {d.toLocaleString("zh-CN")}
            </Text>
            {overdue && <Tag color="error" style={{ marginLeft: 4, fontSize: 10 }}>逾期</Tag>}
          </span>
        );
      }
    },
    {
      title: "内容", dataIndex: "content", ellipsis: true, width: 200,
      render: (v: string) => (
        <Tooltip title={v.length > 80 ? v : undefined} placement="topLeft">
          <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>{v}</Paragraph>
        </Tooltip>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title="跟进 360"
        subtitle="聚合所有客户跟进记录，支持按时间/方式/结果筛选"
      />

      {isLoading || !data ? (
        <Skeleton active />
      ) : (
        <>
          {/* 统计卡片行 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Card size="small">
              <Statistic title="总记录" value={data.totals.total} valueStyle={{ fontSize: 22 }} />
            </Card>
            <Card size="small">
              <Statistic
                title="逾期未跟进"
                value={data.totals.overdue}
                valueStyle={{ fontSize: 22, color: data.totals.overdue > 0 ? "#ff4d4f" : undefined }}
                prefix={data.totals.overdue > 0 ? <ClockCircleOutlined /> : undefined}
              />
            </Card>
            <Card size="small">
              <Statistic title="待定" value={data.totals.pending} valueStyle={{ fontSize: 22, color: "#faad14" }} />
            </Card>
            <Card size="small">
              <Space orientation="vertical" size={4}>
                {data.byMethod.slice(0, 3).map((m) => (
                  <Space key={m.method} size={4}>
                    <Tag color={METHOD_COLOR[m.method]} style={{ margin: 0, fontSize: 10 }}>{METHOD_LABEL[m.method] ?? m.method}</Tag>
                    <Text style={{ fontSize: 12 }}>{m.count}</Text>
                  </Space>
                ))}
              </Space>
            </Card>
          </div>

          {/* 筛选栏 */}
          <Space wrap size={8} style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
            <Space wrap size={8}>
              <Segmented
                value={days}
                onChange={(v) => setDays(v as number)}
                options={DAY_OPTIONS}
              />
              <Select
                allowClear
                placeholder="跟进方式"
                style={{ width: 100 }}
                value={methodFilter}
                onChange={(v) => setMethodFilter(v)}
                options={Object.entries(METHOD_LABEL).map(([k, v]) => ({ value: k, label: v }))}
              />
            </Space>
            <Segmented
              value={resultFilter}
              onChange={(v) => setResultFilter(v as string)}
              options={[
                { label: `全部 (${data.totals.total})`, value: "all" },
                ...data.byResult.map((r) => ({
                  label: `${RESULT_LABEL[r.result] ?? r.result} (${r.count})`,
                  value: r.result
                }))
              ]}
            />
          </Space>

          {data.items.length === 0 ? (
            <Empty description="暂无跟进记录" style={{ marginTop: 40 }} />
          ) : (
            <Table
              rowKey="id" columns={columns} dataSource={data.items}
              size={isMobile ? "small" : "middle"}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
              scroll={{ x: isMobile ? 700 : undefined }}
            />
          )}
        </>
      )}
    </Page>
  );
}
