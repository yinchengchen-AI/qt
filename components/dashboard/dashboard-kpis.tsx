"use client";

import { AuditOutlined, FileTextOutlined, MoneyCollectOutlined, TeamOutlined } from "@ant-design/icons";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { formatCompact } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types/dashboard";

type Props = {
  overview: DashboardSummary["overview"];
  customers: DashboardSummary["customers"];
  invoices: DashboardSummary["invoices"];
  rangeTagLabel: string;
  permHint: string;
};

export function DashboardKpis({ overview: o, customers: cust, invoices: inv, rangeTagLabel, permHint }: Props) {
  const kpiItems: StatItem[] = [
    {
      label: "客户总数",
      icon: <TeamOutlined />,
      tooltip: (
        <>
          客户档案实时数量,包含潜在/在跟/已签约等全部状态(只看 deletedAt IS NULL)。
          <br />
          <b>总数</b> 与统计区间无关;"本期新增"按 <code>createdAt</code> 落在所选区间统计。
          <br />
          {permHint}
        </>
      ),
      value: cust.total,
      suffix: "家",
      description: `${rangeTagLabel}新增 ${cust.newInRange} 家`,
      delta: { value: `${rangeTagLabel}新增 ${cust.newInRange} 家`, direction: "up" }
    },
    {
      label: "合同总额",
      icon: <FileTextOutlined />,
      tooltip: (
        <>
          合同状态为 <b>生效中 / 已完结</b>(枚举 <code>ACTIVE</code> / <code>CLOSED</code>),
          且 <code>isLegacyZeroAmount = false</code>(迁移遗留的 0 元合同排除),
          且 <b>签订日期</b>(<code>signDate</code>)落在统计区间内的 <code>totalAmount</code> 合计(含税口径)。
          <br />
          草稿(<code>DRAFT</code>)不计入。
          <br />
          {permHint}
        </>
      ),
      value: formatCompact(o.contractAmount),
      suffix: "元",
      description: `共 ${o.contractCount} 份有效合同`
    },
    {
      label: "已开票额",
      icon: <AuditOutlined />,
      tooltip: (
        <>
          口径 <code>INVOICE_ISSUED_AMOUNT_STATUSES = [ISSUED, RED_FLUSHED]</code>(v0.10.2 起统一):
          <b>实际开票日期</b>(<code>actualIssueDate</code>)落在统计区间内的 <code>amount</code> 合计。
          <br />
          草稿(<code>DRAFT</code>)、待财务审核(<code>PENDING_FINANCE</code>)、驳回(<code>REJECTED</code>)、作废(<code>VOIDED</code>)不计入。
          <br />
          红冲(<code>RED_FLUSHED</code>)原票按 <code>+A</code> 计入,配套的负数冲票(状态 <code>ISSUED</code>,<code>amount &lt; 0</code>)按 <code>−A</code> 计入,一对红冲净额归零。
          <br />
          "开票率" = 已开票额 ÷ 合同总额。
          <br />
          {permHint}
        </>
      ),
      value: formatCompact(o.invoiceAmount),
      suffix: "元",
      description: `开票率 ${o.invoiceRate}% · ${o.invoiceCount} 张`,
      progress: o.invoiceRate,
      delta: { value: `待审 ${inv.pending} 张待开票`, direction: "flat" }
    },
    {
      label: "已回款额",
      icon: <MoneyCollectOutlined />,
      tooltip: (
        <>
          回款状态为 <b>已确认 / 已对账</b>(枚举 <code>CONFIRMED</code> / <code>RECONCILED</code>),
          且 <b>到账日期</b>(<code>receivedAt</code>)落在统计区间内的 <code>amount</code> 合计。
          <br />
          计划中(<code>PLANNED</code>)、退款(<code>REFUNDED</code>)、取消(<code>CANCELLED</code>)不计入。
          <br />
          "回款率" = 已回款额 ÷ 已开票额;"应收" = 已开票额 − 已回款额(允许为 0,不做负数展示)。
          <br />
          {permHint}
        </>
      ),
      value: formatCompact(o.paymentAmount),
      suffix: "元",
      description: `回款率 ${o.paymentRate}% · ${o.paymentCount} 笔`,
      progress: o.paymentRate,
      delta: { value: "未回款 " + formatCompact(o.unpaidAmount), direction: o.unpaidAmount > 0 ? "down" : "up" }
    }
  ];

  return (
    <section style={{ marginBottom: 16 }}>
      <StatGrid items={kpiItems} columns={4} />
    </section>
  );
}
