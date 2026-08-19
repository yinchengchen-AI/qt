"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Button, Drawer, List, Space, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { EmptyState } from "@/components/empty-state";
import { RiskReportView } from "@/components/workbench/risk-report-view";
import type { ContractRisk, RiskLevel } from "@/server/services/contract/risk-score";

const { Text } = Typography;

export const RISK_LEVEL_META: Record<RiskLevel, { color: string; label: string }> = {
  LOW: { color: "green", label: "低" },
  MEDIUM: { color: "gold", label: "中" },
  HIGH: { color: "orange", label: "高" },
  CRITICAL: { color: "red", label: "严重" }
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

function RiskDetailView({ contractId, contractNo, onBack }: { contractId: string; contractNo: string; onBack: () => void }) {
  return (
    <div>
      <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} style={{ marginBottom: 8 }}>
        返回列表
      </Button>
      <Space size={8} align="center" style={{ marginBottom: 8 }}>
        <Link href={`/contracts/${contractId}`} style={{ fontWeight: 600 }}>{contractNo}</Link>
      </Space>
      <RiskReportView contractId={contractId} />
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
        <RiskDetailView
          contractId={selectedId}
          contractNo={risks.find((r) => r.contractId === selectedId)?.contractNo ?? ""}
          onBack={() => setSelectedId(null)}
        />
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
