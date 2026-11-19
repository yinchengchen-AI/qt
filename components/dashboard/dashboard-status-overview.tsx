"use client";

import { ProCard } from "@ant-design/pro-components";
import { Col, Progress, Row, Space, Typography } from "antd";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";
import { formatCurrency } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types/dashboard";

const { Text } = Typography;

type StatusSummary = DashboardSummary["invoices"]["byStatus"][number];

type Props = {
  invoices: DashboardSummary["invoices"];
  payments: DashboardSummary["payments"];
  primaryColor: string;
};

export function DashboardStatusOverview({ invoices: inv, payments: pay, primaryColor }: Props) {
  const invTotalAmount = inv.byStatus.reduce((sum, item) => sum + item.totalAmount, 0);
  const payTotalAmount = pay.byStatus.reduce((sum, item) => sum + item.totalAmount, 0);
  const statusRow = (domain: "invoice" | "payment", s: StatusSummary, totalAmount: number, unit: string) => (
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
        strokeColor={primaryColor}
        style={{ marginTop: 4, marginBottom: -4 }}
      />
    </div>
  );

  return (
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
  );
}
