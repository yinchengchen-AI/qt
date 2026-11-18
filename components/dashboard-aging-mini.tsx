// Dashboard 账龄迷你卡 (从 dashboard summary 里的 agingBuckets 派生)
// 替代 dashboard/page.tsx 的 IIFE 渲染
"use client";
import { ProCard } from "@ant-design/pro-components";
import { Col, Row, Typography } from "antd";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

const { Text } = Typography;

export type AgingBuckets = Record<"0-30" | "31-60" | "61-90" | "90+", number>;

const BUCKET_COLORS: Record<keyof AgingBuckets, string> = {
  "0-30": "#52c41a",
  "31-60": "#1677ff",
  "61-90": "#faad14",
  "90+": "#ff4d4f"
};

type Props = {
  buckets?: AgingBuckets;
};

export function DashboardAgingMini({ buckets }: Props) {
  const safe: AgingBuckets = {
    "0-30": buckets?.["0-30"] ?? 0,
    "31-60": buckets?.["31-60"] ?? 0,
    "61-90": buckets?.["61-90"] ?? 0,
    "90+": buckets?.["90+"] ?? 0
  };
  const total = safe["0-30"] + safe["31-60"] + safe["61-90"] + safe["90+"];
  if (total === 0) return null;
  const over90Amount = safe["90+"];
  const over90Ratio = (over90Amount / total) * 100;

  return (
    <ProCard
      title="账龄结构（应收）"
      subTitle={
        <Text type="secondary" style={{ fontSize: 12 }}>
          应收总额 {formatCurrency(total)} · 90+ 占比 {over90Ratio.toFixed(1)}%
        </Text>
      }
      style={{ marginBottom: 24 }}
      extra={
        <Link href="/statistics/aging" style={{ fontSize: 13 }}>
          详情 →
        </Link>
      }
    >
      <Row gutter={[12, 12]}>
        {(Object.keys(safe) as (keyof AgingBuckets)[]).map((b) => {
          // 90+ 账龄是最高风险段:金额 >0 时用红框红底强化预警
          const isDanger = b === "90+" && safe[b] > 0;
          return (
            <Col key={b} xs={12} sm={6}>
              <div
                style={{
                  padding: 12,
                  border: `1px solid ${isDanger ? "#ff4d4f66" : "rgba(0,0,0,0.06)"}`,
                  borderLeft: isDanger ? "3px solid #ff4d4f" : "1px solid rgba(0,0,0,0.06)",
                  background: isDanger ? "#ff4d4f0d" : undefined,
                  borderRadius: 6
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>{b} 天</Text>
                <div style={{ fontSize: 18, fontWeight: 600, color: BUCKET_COLORS[b], marginTop: 4 }}>
                  {formatCurrency(safe[b])}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {((safe[b] / total) * 100).toFixed(1)}%
                </Text>
              </div>
            </Col>
          );
        })}
      </Row>
    </ProCard>
  );
}
