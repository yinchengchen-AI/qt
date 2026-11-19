"use client";

import { ProCard } from "@ant-design/pro-components";
import { Badge, Space, Typography } from "antd";
import { EmptyState } from "@/components/empty-state";
import { formatCompact } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types/dashboard";

const { Text } = Typography;

type Props = {
  topCustomers: DashboardSummary["topCustomers"];
  primaryColor: string;
  colorTextTertiary: string;
};

export function DashboardTopCustomers({ topCustomers: top, primaryColor, colorTextTertiary }: Props) {
  const topMax = top.length > 0 ? top[0]!.total : 0;

  return (
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
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 4,
                  bottom: 4,
                  width: `${topMax > 0 ? Math.max(2, (c.total / topMax) * 100) : 0}%`,
                  background: `${primaryColor}14`,
                  borderRadius: 4,
                  pointerEvents: "none"
                }}
              />
              <Space style={{ position: "relative" }}>
                <Badge count={i + 1} style={{ backgroundColor: i < 3 ? primaryColor : colorTextTertiary, fontSize: 11 }} />
                <div>
                  <Text strong>{c.name}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{c.code} · {c.contractCount} 份合同</Text>
                </div>
              </Space>
              <Text strong style={{ position: "relative", fontSize: 16, color: primaryColor }}>{formatCompact(c.total)}</Text>
            </div>
          ))}
        </Space>
      ) : <EmptyState empty title="暂无客户数据" description="当前统计区间内还没有合作的客户" height={120} />}
    </ProCard>
  );
}
