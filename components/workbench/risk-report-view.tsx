"use client";
import useSWR from "swr";
import { List, Space, Typography } from "antd";
import dynamic from "next/dynamic";
import { EmptyState } from "@/components/empty-state";
import { RiskTag } from "@/components/workbench/risk-drawer";
import { useResponsive } from "@/lib/use-breakpoint";
import type { ContractRiskDetail } from "@/server/services/contract/workbench";
import type { RiskLevel } from "@/server/services/contract/risk-score";

// 图表库体积大 (~1MB), 报告区块可见时才加载 (抽屉/详情页按需)
const Radar = dynamic(() => import("@ant-design/charts").then((m) => m.Radar), { ssr: false });
const Line = dynamic(() => import("@ant-design/charts").then((m) => m.Line), { ssr: false });
const Column = dynamic(() => import("@ant-design/charts").then((m) => m.Column), { ssr: false });

const { Text } = Typography;

const DIMENSION_LABELS: Record<string, string> = {
  expiry: "到期风险",
  payment: "付款进度",
  invoicing: "开票进度",
  customerCredit: "客户信用",
  amountAnomaly: "金额异常"
};

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data as T;
};

type Props = { contractId: string };

/** 风险报告视图 (Phase 4a): 雷达 + 维度明细 + 加权公式 + 趋势 + 建议; 工作台抽屉与合同详情页共用 */
export function RiskReportView({ contractId }: Props) {
  const { isPhone } = useResponsive();
  const { data, error, isLoading } = useSWR<ContractRiskDetail>(`/api/contracts/${contractId}/risk`, fetcher);
  if (isLoading) return <EmptyState loading title="计算风险分…" height="small" />;
  if (error || !data) return <EmptyState error={{ message: error?.message ?? "加载失败" }} height="small" />;

  const radarData = Object.entries(data.dimensions).map(([key, d]) => ({
    dim: DIMENSION_LABELS[key] ?? key,
    score: d.score
  }));

  return (
    <div>
      <Space size={8} align="center" style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 15 }}>风险评分 {data.score}</Text>
        <RiskTag level={data.level as RiskLevel} />
        <Text type="secondary" style={{ fontSize: 12 }}>截至 {data.asOf}</Text>
      </Space>
      {/* 手机端雷达降级为纵向条形图 (spec §8.2): 窄屏雷达标签重叠不可读 */}
      {isPhone ? (
        <Column
          data={radarData}
          xField="dim"
          yField="score"
          height={180}
          meta={{ score: { min: 0, max: 100 } }}
          label={{ position: "top", style: { fontSize: 10 } }}
        />
      ) : (
        <Radar
          data={radarData}
          xField="dim"
          yField="score"
          height={220}
          meta={{ score: { min: 0, max: 100 } }}
          point={{ size: 3 }}
          area={{ style: { fillOpacity: 0.2 } }}
        />
      )}
      <List
        size="small"
        dataSource={Object.entries(data.dimensions)}
        renderItem={([key, d]) => (
          <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
            <Space direction="vertical" size={0} style={{ width: "100%" }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Text strong style={{ fontSize: 13 }}>{DIMENSION_LABELS[key] ?? key}</Text>
                <Text style={{ fontSize: 13 }}>{d.score} 分</Text>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>{d.detail}</Text>
            </Space>
          </List.Item>
        )}
      />
      <div style={{ fontSize: 12, color: "rgba(0,0,0,0.45)", marginTop: 4 }}>
        加权公式：{data.weightedScore}
      </div>
      <Typography.Title level={5} style={{ marginTop: 16 }}>近 30 天趋势</Typography.Title>
      {data.trend.length < 2 ? (
        <EmptyState empty title="数据积累中" description="风险快照每日生成，累积 2 天后展示趋势" height="small" />
      ) : (
        <>
          <Line
            data={data.trend.map((t) => ({ date: new Date(t.date).toISOString().slice(5, 10), score: t.score }))}
            xField="date"
            yField="score"
            height={160}
            meta={{ score: { min: 0, max: 100 } }}
            point={{ size: 3 }}
          />
          {data.trendSummary ? (
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.45)", marginTop: 4 }}>
              30 天：{data.trendSummary.from} → {data.trendSummary.to}（主因：{DIMENSION_LABELS[data.trendSummary.mainDriver]}）
            </div>
          ) : null}
        </>
      )}
      <Typography.Title level={5} style={{ marginTop: 16 }}>建议操作</Typography.Title>
      <List
        size="small"
        dataSource={data.recommendations}
        renderItem={(r) => (
          <List.Item style={{ paddingLeft: 0 }}>
            <Text style={{ fontSize: 13 }}>· {r}</Text>
          </List.Item>
        )}
      />
    </div>
  );
}
