"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ProCard } from "@ant-design/pro-components";
import { Column, Pie } from "@ant-design/charts";
import { Badge, Col, Progress, Row, Segmented, Space, Tag, Tooltip, Typography, theme } from "antd";
import {
  TeamOutlined,
  FileTextOutlined,
  AuditOutlined,
  MoneyCollectOutlined,
  InfoCircleOutlined,
  RightOutlined
} from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency, formatDate } from "@/lib/format";
import { StatusTag } from "@/components/status-tag";
import { CONTRACT_STATUS_MAP } from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";
import { DashboardAgingMini } from "@/components/dashboard-aging-mini";

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

// 合同状态环图配色(与 StatusTag 语义对齐)
const CONTRACT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#bfbfbf",
  ACTIVE: "#1677ff",
  CLOSED: "#52c41a"
};

export default function DashboardPage() {
  const { isMobile, isPhone } = useResponsive();
  const [range, setRange] = useState<RangePreset>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useToken();

  useEffect(() => {
    const ab = new AbortController();
    setLoading(true);
    fetch(`/api/dashboard/summary?range=${range}`, { credentials: "include", signal: ab.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ab.signal.aborted) return;
        if (j.code === 0) setData(j.data);
      })
      .catch((e) => {
        if (ab.signal.aborted) return;
        // dashboard 主数据失败时保持现有数据,避免白屏
        console.error("dashboard summary failed", e);
      })
      .finally(() => {
        if (!ab.signal.aborted) setLoading(false);
      });
    return () => ab.abort();
  }, [range]);

  // 催收汇总 — 拉失败时整段隐藏,不阻塞 dashboard 主数据
  const dunningFetcher = async (url: string) => {
    const r = await fetch(url, { credentials: "include" });
    const j = await r.json();
    if (j.code !== 0) throw new Error(j.message);
    return j.data as { byStatus: Record<"CONTACTED" | "PROMISED" | "DISPUTED" | "LEGAL", number> };
  };
  const { data: dunningData } = useSWR<{ byStatus: Record<"CONTACTED" | "PROMISED" | "DISPUTED" | "LEGAL", number> }>(
    "/api/statistics/aging/dunning/summary",
    dunningFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined }
  );

  // 图表高度在窄屏上压缩,避免单屏只能看到 1-2 根柱子
  const chartHeight = isMobile ? 260 : 320;

  if (loading || !data) {
    return (
      <Page>
        <PageHeader title="业务总览" subtitle="实时经营数据快照：客户、合同、开票、回款" />
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
  // 权限提示:SALES 角色只看到自己 owner 的合同/发票/回款(由后端 ownerEq / ownerViaContract 注入)
  const permHint = "数据权限：管理员/财务看全员；业务人员(SALES)看自己负责的合同与对应发票/回款；技术专家(EXPERT)同业务人员。";

  // ── 五大维度 KPI ──
  const kpiItems: StatItem[] = [
    {
      label: "客户总数",
      icon: <TeamOutlined />,
      tooltip: <>客户档案实时数量,包含潜在/在跟/已签约等全部状态。<br/><b>客户档案总数不受统计区间影响</b>;"本期新增"按所选区间统计。<br/>{permHint}</>,
      value: cust.total,
      suffix: "家",
      description: `${rangeTagLabel}新增 ${cust.newInRange} 家`,
      delta: { value: `${rangeTagLabel}新增 ${cust.newInRange} 家`, direction: "up" }
    },
    {
      label: "合同总额",
      icon: <FileTextOutlined />,
      tooltip: <>合同状态为 <b>生效中 / 已完结</b>(对应枚举 ACTIVE / CLOSED),<b>签订日期</b>落在统计区间内的合同金额合计。<br/>草稿、待审、终止、过期不计入。<br/>{permHint}</>,
      value: formatCompact(o.contractAmount),
      suffix: "元",
      description: `共 ${o.contractCount} 份有效合同`
    },
    {
      label: "已开票额",
      icon: <AuditOutlined />,
      tooltip: <>开票状态为 <b>已开票</b>(枚举 ISSUED),<b>实际开票日期</b>(actualIssueDate)落在统计区间内的金额合计。<br/>待财务审核、作废、红冲不计入。"开票率"= 已开票额 ÷ 合同总额。<br/>{permHint}</>,
      value: formatCompact(o.invoiceAmount),
      suffix: "元",
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`,
      progress: o.invoiceRate,
      delta: { value: `待审 ${inv.byStatus.find(s => s.status === "PENDING_FINANCE")?.count ?? 0} 张待开票`, direction: "flat" }
    },
    {
      label: "已回款额",
      icon: <MoneyCollectOutlined />,
      tooltip: <>回款状态为 <b>已确认 / 已对账</b>(枚举 CONFIRMED / RECONCILED),<b>到账日期</b>(receivedAt)落在统计区间内的金额合计。<br/>计划中、退款、作废不计入。"回款率"= 已回款额 ÷ 已开票额。"应收"= 已开票额 − 已回款额。<br/>{permHint}</>,
      value: formatCompact(o.paymentAmount),
      suffix: "元",
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`,
      progress: o.paymentRate,
      delta: { value: "未回款 " + formatCompact(o.unpaidAmount), direction: o.unpaidAmount > 0 ? "down" : "up" }
    }
  ];

  // ── 待办预警(全部为零则不渲染) ──
  const pendingInvoiceCount = inv.byStatus.find(s => s.status === "PENDING_FINANCE")?.count ?? 0;
  const over90Amount = data.agingBuckets?.["90+"] ?? 0;
  const dunningActive = dunningData
    ? (dunningData.byStatus.CONTACTED ?? 0) + (dunningData.byStatus.PROMISED ?? 0) + (dunningData.byStatus.DISPUTED ?? 0)
    : 0;
  const dunningLegal = dunningData?.byStatus.LEGAL ?? 0;
  const todoItems: { label: string; value: string; href: string; color: string }[] = [];
  if (pendingInvoiceCount > 0) todoItems.push({ label: "待开票", value: `${pendingInvoiceCount} 张`, href: "/invoices", color: token.colorPrimary });
  if (over90Amount > 0) todoItems.push({ label: "90+ 账龄", value: formatCompact(over90Amount), href: "/statistics/aging", color: "#ff4d4f" });
  if (dunningActive > 0) todoItems.push({ label: "催收中", value: `${dunningActive} 张`, href: "/statistics/aging", color: "#faad14" });
  if (dunningLegal > 0) todoItems.push({ label: "法务介入", value: `${dunningLegal} 张`, href: "/statistics/aging", color: "#cf1322" });

  const townData = data.townDistribution;

  // ── 合同状态环图 ──
  const contractTotal = cont.byStatus.reduce((s, x) => s + x.count, 0);
  const contractPieData = cont.byStatus.map(x => ({
    status: x.status,
    label: CONTRACT_STATUS_MAP[x.status] ?? x.status,
    count: x.count
  }));

  // ── 开票/回款概况行内占比 ──
  const invTotalAmount = inv.byStatus.reduce((s, x) => s + x.totalAmount, 0);
  const payTotalAmount = pay.byStatus.reduce((s, x) => s + x.totalAmount, 0);
  const statusRow = (domain: "invoice" | "payment", s: { status: string; count: number; totalAmount: number }, totalAmount: number, unit: string) => (
    <div key={s.status} style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <StatusTag status={s.status} domain={domain} />
        <Space>
          <Text strong>{s.count} {unit}</Text>
          <Text type="secondary">{formatCurrency(s.totalAmount)}</Text>
        </Space>
      </div>
      <Progress
        percent={totalAmount > 0 ? (s.totalAmount / totalAmount) * 100 : 0}
        size={{ height: 3 }}
        showInfo={false}
        strokeColor={token.colorPrimary}
        style={{ marginTop: 4, marginBottom: -4 }}
      />
    </div>
  );

  // Top 客户占比(以第一名为 100%)
  const topMax = top.length > 0 ? top[0]!.total : 0;

  return (
    <Page>
      <PageHeader
        title="业务总览"
        subtitle="鼠标悬停 KPI 标题旁的 ⓘ 可查看口径说明"
        actions={
          <Segmented<RangePreset>
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v)}
            size="small"
          />
        }
      />

      {/* 区间行:日期 + 预设 Tag + 权限提示(收 ⓘ) */}
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

      <section style={{ marginBottom: 16 }}>
        <StatGrid items={kpiItems} columns={4} />
      </section>

      {/* 待办预警:仅非零项显示,点击跳对应页面 */}
      {todoItems.length > 0 && (
        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
          {todoItems.map((it) => (
            <Col key={it.label} xs={12} sm={6}>
              <Link href={it.href} style={{ display: "block" }}>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    border: `1px solid ${it.color}33`,
                    borderLeft: `3px solid ${it.color}`,
                    background: `${it.color}0d`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{it.label}</Text>
                    <div style={{ fontSize: 16, fontWeight: 600, color: it.color }}>{it.value}</div>
                  </div>
                  <RightOutlined style={{ color: it.color, fontSize: 12 }} />
                </div>
              </Link>
            </Col>
          ))}
        </Row>
      )}

      {/*** 区域分布 + 合同状态 ***/}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
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
        <Col xs={24} lg={8}>
          <ProCard title="合同状态" subTitle={`共 ${contractTotal} 份`}>
            {contractPieData.length > 0 ? (
              <Pie
                data={contractPieData}
                angleField="count"
                colorField="label"
                height={chartHeight}
                innerRadius={0.6}
                autoFit
                legend={{ color: { position: "bottom" } }}
                label={{ text: "count", style: { fontSize: 12, fontWeight: 600 } }}
                scale={{
                  color: {
                    range: contractPieData.map((d) => CONTRACT_STATUS_COLORS[d.status] ?? token.colorPrimary)
                  }
                }}
              />
            ) : <EmptyState empty title="暂无合同数据" description="当前还没有任何合同" height={chartHeight} />}
          </ProCard>
        </Col>
      </Row>

      {/*** 开票 + 回款概况 ***/}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <ProCard title="开票概况" subTitle={`合计 ${formatCurrency(invTotalAmount)}`}>
            {inv.byStatus.length > 0
              ? inv.byStatus.map((s) => statusRow("invoice", s, invTotalAmount, "张"))
              : <EmptyState empty title="暂无开票数据" height={100} />}
          </ProCard>
        </Col>
        <Col xs={24} lg={12}>
          <ProCard title="回款概况" subTitle={`合计 ${formatCurrency(payTotalAmount)}`}>
            {pay.byStatus.length > 0
              ? pay.byStatus.map((s) => statusRow("payment", s, payTotalAmount, "笔"))
              : <EmptyState empty title="暂无回款数据" height={100} />}
          </ProCard>
        </Col>
      </Row>

      <DashboardAgingMini
        buckets={data.agingBuckets as never}
        dunningByStatus={dunningData?.byStatus}
      />

      {/*** Top 客户 ***/}
      <ProCard title="Top 5 客户（按合同额）" style={{ marginBottom: 24 }}>
        {top.length > 0 ? (
          <Space orientation="vertical" style={{ width: "100%" }} size={0}>
            {top.map((c, i) => (
              <div
                key={c.id}
                style={{
                  position: "relative",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 8px",
                  borderBottom: i < top.length - 1 ? "1px solid #f0f0f0" : "none",
                  gap: 8,
                  flexWrap: "wrap"
                }}
              >
                {/* 占比条形背景(以第一名为 100%) */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 4,
                    bottom: 4,
                    width: `${topMax > 0 ? Math.max(2, (c.total / topMax) * 100) : 0}%`,
                    background: `${token.colorPrimary}14`,
                    borderRadius: 4,
                    pointerEvents: "none"
                  }}
                />
                <Space style={{ position: "relative" }}>
                  <Badge count={i + 1} style={{ backgroundColor: i < 3 ? token.colorPrimary : token.colorTextTertiary, fontSize: 11 }} />
                  <div>
                    <Text strong>{c.name}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{c.code} · {c.contractCount} 份合同</Text>
                  </div>
                </Space>
                <Text strong style={{ position: "relative", fontSize: 16, color: token.colorPrimary }}>{formatCompact(c.total)}</Text>
              </div>
            ))}
          </Space>
        ) : <EmptyState empty title="暂无客户数据" description="当前统计区间内还没有合作的客户" height={120} />}
      </ProCard>
    </Page>
  );
}
