"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Button, Segmented, Tag, Tooltip, Typography, theme } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { DashboardKpis } from "@/components/dashboard/dashboard-kpis";
import { DashboardTodos } from "@/components/dashboard/dashboard-todos";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { DashboardStatusOverview } from "@/components/dashboard/dashboard-status-overview";
import { DashboardTopCustomers } from "@/components/dashboard/dashboard-top-customers";
import { formatDate } from "@/lib/format";
import { fetchApiData } from "@/lib/fetch-api";
import { useResponsive } from "@/lib/use-breakpoint";
import { DashboardAgingMini } from "@/components/dashboard-aging-mini";
import type { RangePreset } from "@/lib/date-range";
import type { DashboardSummary } from "@/lib/types/dashboard";

const { Text } = Typography;
const { useToken } = theme;
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "month", label: "月度" },
  { value: "quarter", label: "季度" },
  { value: "year", label: "年度" }
];

export default function DashboardPage() {
  const { isMobile, isPhone } = useResponsive();
  const [range, setRange] = useState<RangePreset>("month");
  const summary = useSWR<DashboardSummary, Error>(
    `/api/dashboard/summary?range=${range}`,
    fetchApiData,
    { keepPreviousData: true, revalidateOnFocus: false }
  );
  const { token } = useToken();

  const chartHeight = isMobile ? 260 : 320;

  if (summary.isLoading && !summary.data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="实时经营数据快照：客户、合同、开票、回款" />
        <StatGrid columns={4} loading items={[{}, {}, {}, {}] as StatItem[]} />
        <div style={{ height: 24 }} />
        <StatGrid columns={3} loading items={[{}, {}, {}] as StatItem[]} />
      </Page>
    );
  }

  if (summary.error && !summary.data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="实时经营数据快照：客户、合同、开票、回款" />
        <EmptyState
          error={{
            message: summary.error.message,
            onRetry: () => {
              void summary.mutate();
            }
          }}
        />
      </Page>
    );
  }

  const data = summary.data!;
  const { overview: o } = data;
  const rangeFrom = o.range?.from ? new Date(o.range.from) : null;
  const rangeTo = o.range?.to ? new Date(o.range.to) : null;
  const now = new Date();
  const rangeMatchesPreset = (() => {
    if (!rangeFrom || !rangeTo) return false;
    if (range === "month") {
      return rangeFrom.getFullYear() === now.getFullYear()
        && rangeFrom.getMonth() === now.getMonth()
        && rangeFrom.getDate() === 1;
    }
    if (range === "year") {
      return rangeFrom.getFullYear() === now.getFullYear()
        && rangeFrom.getMonth() === 0
        && rangeFrom.getDate() === 1;
    }
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return rangeFrom.getFullYear() === now.getFullYear()
      && rangeFrom.getMonth() === qStartMonth
      && rangeFrom.getDate() === 1;
  })();
  const rangeTagLabel = range === "month" ? "本月" : range === "quarter" ? "本季" : "本年";
  const permHint = "数据权限：管理员 / 财务 / 运营看全员；SALES / EXPERT 看自己";

  return (
    <Page>
      <PageHeader
        title="业务总览"
        subtitle="鼠标悬停 KPI 标题旁的 ⓘ 查看口径说明;右上 ⓘ 查看数据权限"
        actions={
          <Segmented<RangePreset>
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v)}
            size="small"
          />
        }
      />

      {summary.isValidating ? (
        <Alert type="info" showIcon message="数据更新中" style={{ marginBottom: 16 }} />
      ) : null}
      {summary.error ? (
        <Alert
          type="warning"
          showIcon
          message="数据刷新失败，当前展示上次成功结果"
          action={(
            <Button
              size="small"
              onClick={() => {
                void summary.mutate();
              }}
            >
              重试
            </Button>
          )}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Text strong style={{ fontSize: 13 }}>
          {rangeFrom ? formatDate(rangeFrom) : "—"}
          {"  ~  "}
          {rangeTo ? formatDate(rangeTo) : "—"}
        </Text>
        {rangeMatchesPreset ? <Tag color="blue">{rangeTagLabel}</Tag> : null}
        {!isPhone && (
          <Tooltip title={permHint} placement="bottom">
            <InfoCircleOutlined style={{ color: token.colorTextTertiary, fontSize: 13, cursor: "help" }} />
          </Tooltip>
        )}
      </div>

      <DashboardKpis
        overview={data.overview}
        customers={data.customers}
        invoices={data.invoices}
        rangeTagLabel={rangeTagLabel}
        permHint={permHint}
      />
      <DashboardTodos
        pendingInvoiceCount={data.invoices.pending}
        over90Amount={data.agingBuckets?.["90+"] ?? 0}
        primaryColor={token.colorPrimary}
      />
      <DashboardCharts
        townDistribution={data.townDistribution}
        contracts={data.contracts}
        chartHeight={chartHeight}
        primaryColor={token.colorPrimary}
      />
      <DashboardStatusOverview
        invoices={data.invoices}
        payments={data.payments}
        primaryColor={token.colorPrimary}
      />
      <DashboardAgingMini buckets={data.agingBuckets} />
      <DashboardTopCustomers
        topCustomers={data.topCustomers}
        primaryColor={token.colorPrimary}
        colorTextTertiary={token.colorTextTertiary}
      />
    </Page>
  );
}
