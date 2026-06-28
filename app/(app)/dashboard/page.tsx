"use client";
import { useEffect, useState } from "react";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { Badge, Col, Row, Segmented, Space, Tag, Typography, theme } from "antd";
import { CalendarOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { HintBox } from "@/components/callout";
import { formatCompact, formatCurrency, formatDate } from "@/lib/format";
import { StatusTag } from "@/components/status-tag";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;
const { useToken } = theme;

type DashboardData = {
  overview: { contractAmount: number; invoiceAmount: number; paymentAmount: number; unpaidAmount: number; invoiceRate: number; paymentRate: number; contractCount: number; invoiceCount: number; paymentCount: number; range: { from?: string; to?: string } };
  distribution: { byScale: { key: string; count: number }[]; byType: { key: string; count: number }[]; byStatus: { key: string; count: number }[] };
  townDistribution: { town: string | null; count: number }[];
  agingBuckets: Record<string, number>;
  customers: { total: number; newInRange: number };
  contracts: { byStatus: { status: string; count: number; totalAmount: number }[] };
  invoices: { total: number; byStatus: { status: string; count: number; totalAmount: number }[] };
  payments: { total: number; byStatus: { status: string; count: number; totalAmount: number }[] };
  topCustomers: { id: string; name: string; code: string; total: number; contractCount: number }[];
};

type RangePreset = "month" | "quarter" | "year";
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "month", label: "月度" },
  { value: "quarter", label: "季度" },
  { value: "year", label: "年度" },
];

export default function DashboardPage() {
  const { isMobile } = useResponsive();
  const [range, setRange] = useState<RangePreset>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useToken();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/summary?range=${range}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j.code === 0) setData(j.data);
      })
      .finally(() => setLoading(false));
  }, [range]);

  // 图表高度在窄屏上压缩,避免单屏只能看到 1-2 根柱子
  const chartHeight = isMobile ? 280 : 420;

  if (loading || !data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="实时经营数据快照：客户、合同、项目、开票、回款" />
        <StatGrid columns={4} loading items={[{},{},{},{}] as StatItem[]} />
        <div style={{ height: 24 }} />
        <StatGrid columns={3} loading items={[{},{},{}] as StatItem[]} />
      </Page>
    );
  }

  const { overview: o, customers: cust, invoices: inv, payments: pay, contracts: cont, topCustomers: top } = data;

  // ── 统计区间(取自 overview.range,接口默认本月) ──
  const rangeFrom = o.range?.from ? new Date(o.range.from) : null;
  const rangeTo = o.range?.to ? new Date(o.range.to) : null;
  const now = new Date();
  // 区间标签:根据当前选中的 range 判断是否匹配
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
    // quarter: 起点 = 当前季度的 1 号
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return rangeFrom.getFullYear() === now.getFullYear()
      && rangeFrom.getMonth() === qStartMonth
      && rangeFrom.getDate() === 1;
  })();
  const rangeTagLabel = range === "month" ? "本月" : range === "quarter" ? "本季" : "本年";
  // 权限提示:SALES 角色只看到自己 owner 的合同/发票/回款(由后端 ownerEq / ownerViaContract 注入)
  const permHint = "数据权限：管理员/财务可看全员；销售仅看本人负责的合同、对应发票与回款。";

  // ── 五大维度 KPI ──
  const kpiItems: StatItem[] = [
    {
      label: "客户总数",
      tooltip: <>客户档案实时数量,包含潜在/在跟/已签约等全部状态。<br/><b>客户档案总数不受统计区间影响</b>;"本期新增"按所选区间统计。<br/>{permHint}</>,
      value: cust.total,
      suffix: "家",
      description: `${rangeTagLabel}新增 ${cust.newInRange} 家`,
      delta: { value: `${rangeTagLabel}新增 ${cust.newInRange} 家`, direction: "up" }
    },
    {
      label: "合同总额",
      tooltip: <>合同状态为 <b>生效中 / 已完结</b>(对应枚举 ACTIVE / CLOSED),<b>签订日期</b>落在统计区间内的合同金额合计。<br/>草稿、待审、终止、过期不计入。<br/>{permHint}</>,
      value: formatCompact(o.contractAmount),
      suffix: "元",
      description: `共 ${o.contractCount} 份有效合同`
    },
    {
      label: "已开票额",
      tooltip: <>开票状态为 <b>已开票</b>(枚举 ISSUED),<b>实际开票日期</b>(actualIssueDate)落在统计区间内的金额合计。<br/>待财务审核、作废、红冲不计入。"开票率"= 已开票额 ÷ 合同总额。<br/>{permHint}</>,
      value: formatCompact(o.invoiceAmount),
      suffix: "元",
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`,
      delta: { value: `待审 ${inv.byStatus.find(s => s.status === "PENDING_FINANCE")?.count ?? 0} 张待开票`, direction: "flat" }
    },
    {
      label: "已回款额",
      tooltip: <>回款状态为 <b>已确认 / 已对账</b>(枚举 CONFIRMED / RECONCILED),<b>到账日期</b>(receivedAt)落在统计区间内的金额合计。<br/>计划中、退款、作废不计入。"回款率"= 已回款额 ÷ 已开票额。"应收"= 已开票额 − 已回款额。<br/>{permHint}</>,
      value: formatCompact(o.paymentAmount),
      suffix: "元",
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`,
      delta: { value: "未回款 " + formatCompact(o.unpaidAmount), direction: o.unpaidAmount > 0 ? "down" : "up" }
    }
  ];

  const townData = data.townDistribution;

  // ── 合同状态分布 ──
  const contractStatusData = cont.byStatus.map(x => ({ status: x.status, count: x.count }));

  return (
    <Page>
      <PageHeader title="业务总览" subtitle="顶部 Segmented 切换月度/季度/年度统计区间；鼠标悬停 KPI 标题旁的 ⓘ 可查看口径说明。" />

      <HintBox style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <CalendarOutlined style={{ color: token.colorTextTertiary }} />
        <Text type="secondary" style={{ fontSize: 12 }}>统计区间</Text>
        <Segmented<RangePreset>
          options={RANGE_OPTIONS}
          value={range}
          onChange={(v) => setRange(v)}
          size="small"
        />
        <Text strong style={{ fontSize: 13 }}>
          {rangeFrom ? formatDate(rangeFrom) : "—"}
          {"  ~  "}
          {rangeTo ? formatDate(rangeTo) : "—"}
        </Text>
        {rangeMatchesPreset ? <Tag color="blue" style={{ marginInlineStart: 4 }}>{rangeTagLabel}</Tag> : null}
        <Text type="secondary" style={{ fontSize: 12, marginInlineStart: "auto" }}>{permHint}</Text>
      </HintBox>

      <section style={{ marginBottom: 24 }}>
        <StatGrid items={kpiItems} columns={4} />
      </section>

      {/*** 客户 + 区域分布 ***/}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={24}>
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
            ) : <EmptyState empty title="暂无区域分布数据" description="客户所在地尚未录入镇街信息；请在客户档案中补充所在镇街" height={chartHeight} />}
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
            )) : <EmptyState empty title="暂无合同数据" description="当前还没有任何合同" height={100} />}
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
          <Space orientation="vertical" style={{ width: "100%" }} size={0}>
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
        ) : <EmptyState empty title="暂无客户数据" description="当前统计区间内还没有合作的客户" height={120} />}
      </ProCard>
    </Page>
  );
}
