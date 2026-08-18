"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { Button, Drawer, List, Space, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { EmptyState } from "@/components/empty-state";
import type { ContractRiskDetail } from "@/server/services/contract/workbench";
import type { ContractRisk, RiskLevel } from "@/server/services/contract/risk-score";

// 图表库体积大 (~1MB), 抽屉打开时才加载, 不拖慢工作台首屏
const Radar = dynamic(() => import("@ant-design/charts").then((m) => m.Radar), { ssr: false });
const Line = dynamic(() => import("@ant-design/charts").then((m) => m.Line), { ssr: false });

const { Text } = Typography;

export const RISK_LEVEL_META: Record<RiskLevel, { color: string; label: string }> = {
  LOW: { color: "green", label: "低" },
  MEDIUM: { color: "gold", label: "中" },
  HIGH: { color: "orange", label: "高" },
  CRITICAL: { color: "red", label: "严重" }
};

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

export function RiskTag({ level, score }: { level: RiskLevel; score?: number }) {
  const meta = RISK_LEVEL_META[level];
  return <Tag color={meta.color}>{score === undefined ? meta.label : `${meta.label} ${score}`}</Tag>;
}

function RiskDetailView({ contractId, onBack }: { contractId: string; onBack: () => void }) {
  const { data, error, isLoading } = useSWR<ContractRiskDetail>(`/api/contracts/${contractId}/risk`, fetcher);
  if (isLoading) return <EmptyState loading title="计算风险分…" height="small" />;
  if (error || !data) return <EmptyState error={{ message: error?.message ?? "加载失败" }} height="small" />;

  const radarData = Object.entries(data.dimensions).map(([key, d]) => ({
    dim: DIMENSION_LABELS[key] ?? key,
    score: d.score
  }));

  return (
    <div>
      <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} style={{ marginBottom: 8 }}>
        返回列表
      </Button>
      <Space size={8} align="center" style={{ marginBottom: 8 }}>
        <Link href={`/contracts/${data.contractId}`} style={{ fontWeight: 600 }}>{data.contractNo}</Link>
        <RiskTag level={data.level} score={data.score} />
      </Space>
      <div style={{ color: "rgba(0,0,0,0.55)", fontSize: 13, marginBottom: 12 }}>
        {data.customerName} · {data.title}
      </div>
      <Radar
        data={radarData}
        xField="dim"
        yField="score"
        height={220}
        meta={{ score: { min: 0, max: 100 } }}
        point={{ size: 3 }}
        area={{ style: { fillOpacity: 0.2 } }}
      />
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
      <Typography.Title level={5} style={{ marginTop: 16 }}>近 30 天趋势</Typography.Title>
      {data.trend.length < 2 ? (
        <EmptyState empty title="数据积累中" description="风险快照每日生成，累积 2 天后展示趋势" height="small" />
      ) : (
        <Line
          data={data.trend.map((t) => ({ date: new Date(t.date).toISOString().slice(5, 10), score: t.score }))}
          xField="date"
          yField="score"
          height={160}
          meta={{ score: { min: 0, max: 100 } }}
          point={{ size: 3 }}
        />
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

type Props = { open: boolean; onClose: () => void };

/** 风险抽屉: MEDIUM+ 风险合同列表 → 单合同风险详情 (雷达 + 趋势 + 建议) */
export function RiskDrawer({ open, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: risks = [], isLoading } = useSWR<ContractRisk[]>(
    open ? "/api/contracts/my-risk" : null,
    fetcher
  );

  return (
    <Drawer
      title={selectedId ? "风险详情" : "我的风险合同"}
      width={420}
      open={open}
      onClose={() => {
        setSelectedId(null);
        onClose();
      }}
      destroyOnHidden
    >
      {selectedId ? (
        <RiskDetailView contractId={selectedId} onBack={() => setSelectedId(null)} />
      ) : isLoading ? (
        <EmptyState loading title="加载风险合同…" height="small" />
      ) : risks.length === 0 ? (
        <EmptyState empty title="暂无风险合同" description="我的活跃合同风险等级均为低" height="small" />
      ) : (
        <List
          size="small"
          dataSource={risks}
          renderItem={(r) => (
            <List.Item
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedId(r.contractId)}
              actions={[<RightOutlined key="go" style={{ fontSize: 10, color: "rgba(0,0,0,0.45)" }} />]}
            >
              <Space size={8} wrap>
                <RiskTag level={r.level} score={r.score} />
                <span style={{ fontWeight: 600 }}>{r.contractNo}</span>
                <Text type="secondary" style={{ fontSize: 13 }}>{r.customerName}</Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
