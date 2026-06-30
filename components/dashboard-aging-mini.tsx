// Dashboard 账龄迷你卡 (从 dashboard summary 里的 agingBuckets + dunning/summary 派生)
// 替代 dashboard/page.tsx 的 IIFE 渲染
"use client";
import { ProCard } from "@ant-design/pro-components";
import { Col, Row, Tag, Typography } from "antd";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { useT } from "@/lib/i18n";

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
  /** 来自 /api/statistics/aging/dunning/summary 的催收 byStatus 计数; 可选, 没拉成功时整段隐藏 */
  dunningByStatus?: Record<"CONTACTED" | "PROMISED" | "DISPUTED" | "LEGAL", number>;
};

export function DashboardAgingMini({ buckets, dunningByStatus }: Props) {
  const t = useT();
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
  const dunningTotal = dunningByStatus
    ? (dunningByStatus.CONTACTED ?? 0) +
      (dunningByStatus.PROMISED ?? 0) +
      (dunningByStatus.DISPUTED ?? 0) +
      (dunningByStatus.LEGAL ?? 0)
    : null;

  return (
    <ProCard
      title="账龄结构（应收）"
      subTitle={
        <Text type="secondary" style={{ fontSize: 12 }}>
          应收总额 {formatCurrency(total)} · 90+ 占比 {over90Ratio.toFixed(1)}%
          {dunningTotal !== null ? ` · 催收中 ${dunningTotal} 张` : ""}
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
        {(Object.keys(safe) as (keyof AgingBuckets)[]).map((b) => (
          <Col key={b} xs={12} sm={6}>
            <div
              style={{
                padding: 12,
                border: "1px solid rgba(0,0,0,0.06)",
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
        ))}
      </Row>
      {dunningByStatus ? (
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t("aging.dunning.title")}:</Text>
          <Tag color="blue">已联系 {dunningByStatus.CONTACTED ?? 0}</Tag>
          <Tag color="green">客户承诺 {dunningByStatus.PROMISED ?? 0}</Tag>
          <Tag color="orange">争议 {dunningByStatus.DISPUTED ?? 0}</Tag>
          <Tag color="red">法务介入 {dunningByStatus.LEGAL ?? 0}</Tag>
        </div>
      ) : null}
    </ProCard>
  );
}
