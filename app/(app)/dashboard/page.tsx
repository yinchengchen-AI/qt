"use client";
import { useEffect, useState } from "react";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { Col, Row, Space, Typography, Badge, theme } from "antd";
import { formatStatus } from "@/lib/status";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency } from "@/lib/format";
import { StatusTag } from "@/components/status-tag";
import { MyTasksWidget } from "@/components/workflow/my-tasks-widget";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;
const { useToken } = theme;

type DashboardData = {
  overview: { contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number; invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number };
  distribution: { byScale: { key: string; count: number }[]; byType: { key: string; count: number }[]; byStatus: { key: string; count: number }[] };
  townDistribution: { town: string | null; count: number }[];
  agingBuckets: Record<string, number>;
  customers: { total: number; newThisMonth: number };
  projects: { total: number; byStatus: { status: string; count: number }[] };
  contracts: { byStatus: { status: string; count: number; totalAmount: number }[] };
  invoices: { total: number; byStatus: { status: string; count: number; totalAmount: number }[] };
  payments: { total: number; byStatus: { status: string; count: number; totalAmount: number }[] };
  topCustomers: { id: string; name: string; code: string; total: number; contractCount: number }[];
};

export default function DashboardPage() {
  const { isMobile } = useResponsive();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useToken();

  useEffect(() => {
    fetch("/api/dashboard/summary", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j.code === 0) setData(j.data);
      })
      .finally(() => setLoading(false));
  }, []);

  // 图表高度在窄屏上压缩,避免单屏只能看到 1-2 根柱子
  const chartHeight = isMobile ? 280 : 420;

  if (loading || !data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="实时经营数据快照 — 客户、合同、项目、开票、回款" />
        <StatGrid columns={5} loading items={[{},{},{},{},{}] as StatItem[]} />
        <div style={{ height: 24 }} />
        <StatGrid columns={3} loading items={[{},{},{}] as StatItem[]} />
      </Page>
    );
  }

  const { overview: o, customers: cust, projects: proj, invoices: inv, payments: pay, contracts: cont, topCustomers: top } = data;

  // ── 五大维度 KPI ──
  const kpiItems: StatItem[] = [
    {
      label: "客户总数",
      value: cust.total,
      suffix: "家",
      description: `本月新增 ${cust.newThisMonth} 家`,
      delta: { value: `+${cust.newThisMonth} 本月新增`, direction: "up" }
    },
    {
      label: "合同总额",
      value: formatCompact(o.contractAmount),
      suffix: "元",
      description: `共 ${o.contractCount} 份有效合同`
    },
    {
      label: "项目总数",
      value: proj.total,
      suffix: "个",
      description: `进行中 ${proj.byStatus.find(s => s.status === "IN_PROGRESS")?.count ?? 0} 个`,
      delta: { value: `${((proj.byStatus.find(s => s.status === "COMPLETED")?.count ?? 0) / Math.max(proj.total, 1) * 100).toFixed(0)}% 完成`, direction: "flat" }
    },
    {
      label: "已开票额",
      value: formatCompact(o.invoiceAmount),
      suffix: "元",
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`,
      delta: { value: `待审 ${inv.byStatus.find(s => s.status === "PENDING_FINANCE")?.count ?? 0} 张`, direction: "flat" }
    },
    {
      label: "已回款额",
      value: formatCompact(o.paymentAmount),
      suffix: "元",
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`,
      delta: { value: "应收 " + formatCompact(o.unpaidAmount), direction: o.unpaidAmount > 0 ? "down" : "up" }
    }
  ];

  const townData = data.townDistribution;

  // ── 项目状态分布 ──
  const projectStatusData = proj.byStatus.map(x => ({ status: formatStatus(x.status, "project").label, count: x.count }));

  // ── 合同状态分布 ──
  const contractStatusData = cont.byStatus.map(x => ({ status: x.status, count: x.count }));

  return (
    <Page>
      <PageHeader title="业务总览" subtitle="实时经营数据快照 — 客户、合同、项目、开票、回款" />

      <section style={{ marginBottom: 24 }}>
        <StatGrid items={kpiItems} columns={5} />
      </section>

      <MyTasksWidget />

      {/*** 客户 + 项目 分布 ***/}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <ProCard title="客户区域分布" subTitle="按镇街分组">
            {townData.length > 0 ? (
              <Column
                data={townData}
                xField="town"
                yField="count"
                height={chartHeight}
                colorField="town"
                autoFit
                label={{ text: (d: Record<string, unknown>) => String(d.count), style: { fontSize: 11 } }}
                xAxis={{ label: { autoRotate: true, autoHide: false } }}
              />
            ) : <EmptyState empty title="暂无区域分布数据" description="客户所在地尚未录入镇街信息" height={chartHeight} />}
          </ProCard>
        </Col>
        <Col xs={24} lg={12}>
          <ProCard title="项目状态分布">
            {projectStatusData.length > 0 ? (
              <Column
                data={projectStatusData}
                xField="status"
                yField="count"
                height={chartHeight}
                colorField="status"
                autoFit
              />
            ) : <EmptyState empty title="暂无项目数据" height={chartHeight} />}
          </ProCard>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={8}>
          <ProCard title="合同状态">
            {contractStatusData.length > 0 ? contractStatusData.map((s) => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                <StatusTag status={s.status} domain="contract" />
                <Text strong>{s.count} 份</Text>
              </div>
            )) : <EmptyState empty title="暂无数据" height={100} />}
          </ProCard>
        </Col>
        <Col xs={24} lg={8}>
          <ProCard title="开票概况">
            {inv.byStatus.map((s) => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                <StatusTag status={s.status} domain="invoice" />
                <Space>
                  <Text strong>{s.count} 张</Text>
                  <Text type="secondary">{formatCurrency(s.totalAmount).replace("¥", "¥")}</Text>
                </Space>
              </div>
            ))}
          </ProCard>
        </Col>
        <Col xs={24} lg={8}>
          <ProCard title="回款概况">
            {pay.byStatus.map((s) => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                <StatusTag status={s.status} domain="payment" />
                <Space>
                  <Text strong>{s.count} 笔</Text>
                  <Text type="secondary">{formatCurrency(s.totalAmount).replace("¥", "¥")}</Text>
                </Space>
              </div>
            ))}
          </ProCard>
        </Col>
      </Row>

      {/*** Top 客户 ***/}
      <ProCard title="Top 5 客户（按合同额）" style={{ marginBottom: 24 }}>
        {top.length > 0 ? (
          <Space direction="vertical" style={{ width: "100%" }} size={0}>
            {top.map((c, i) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < top.length - 1 ? "1px solid #f0f0f0" : "none", gap: 8, flexWrap: "wrap" }}>
                <Space>
                  <Badge count={i + 1} style={{ backgroundColor: i < 3 ? token.colorPrimary : token.colorTextTertiary, fontSize: 11 }} />
                  <div>
                    <Text strong>{c.name}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{c.code} · {c.contractCount} 份合同</Text>
                  </div>
                </Space>
                <Text strong style={{ fontSize: 16, color: token.colorPrimary }}>{formatCompact(c.total)}</Text>
              </div>
            ))}
          </Space>
        ) : <EmptyState empty title="暂无客户数据" height={120} />}
      </ProCard>
    </Page>
  );
}
