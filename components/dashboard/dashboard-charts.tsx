"use client";

import dynamic from "next/dynamic";
import { ProCard } from "@ant-design/pro-components";
import { Col, Row } from "antd";
import { EmptyState } from "@/components/empty-state";
import { CONTRACT_STATUS_MAP } from "@/lib/enum-maps";
import type { DashboardSummary } from "@/lib/types/dashboard";
import { buildTownChartData } from "./dashboard-view-model";

const Column = dynamic(() => import("@ant-design/charts").then((m) => m.Column), { ssr: false });
const Pie = dynamic(() => import("@ant-design/charts").then((m) => m.Pie), { ssr: false });

const TOWN_TOP_N = 10;
const CONTRACT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#bfbfbf",
  ACTIVE: "#1677ff",
  CLOSED: "#52c41a"
};

type Props = {
  townDistribution: DashboardSummary["townDistribution"];
  contracts: DashboardSummary["contracts"];
  chartHeight: number;
  primaryColor: string;
};

export function DashboardCharts({ townDistribution, contracts: cont, chartHeight, primaryColor }: Props) {
  const { data: townData, truncated: townTruncated } = buildTownChartData(townDistribution, TOWN_TOP_N);
  const contractTotal = cont.byStatus.reduce((sum, item) => sum + item.count, 0);
  const contractPieData = cont.byStatus.map((item) => ({
    status: item.status,
    label: CONTRACT_STATUS_MAP[item.status] ?? item.status,
    count: item.count
  }));

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
      <Col xs={24} lg={16}>
        <ProCard title="客户区域分布" subTitle={townTruncated ? `按镇街分组（前 ${TOWN_TOP_N}）` : "按镇街分组"}>
          {townData.length > 0 ? (
            <Column
              data={townData}
              xField="town"
              yField="count"
              height={chartHeight}
              colorField="town"
              autoFit
              label={{ text: (d: Record<string, unknown>) => String(d.count), style: { fontSize: 11 } }}
              xAxis={{ label: { autoRotate: true, autoHide: true } }}
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
                  range: contractPieData.map((d) => CONTRACT_STATUS_COLORS[d.status] ?? primaryColor)
                }
              }}
            />
          ) : <EmptyState empty title="暂无合同数据" description="当前还没有任何合同" height={chartHeight} />}
        </ProCard>
      </Col>
    </Row>
  );
}
