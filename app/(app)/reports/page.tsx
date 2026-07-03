"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Row, Col, Tag, Spin, Button, Empty } from "antd";
import {
  FileTextOutlined,
  ReloadOutlined,
  BarChartOutlined,
  TeamOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { useResponsive } from "@/lib/use-breakpoint";
import { reportPeriodLabel, reportStatusLabel } from "@/lib/report-labels";

const TYPE_ICON: Record<string, React.ReactNode> = {
  FINANCIAL: <BarChartOutlined />,
  BUSINESS: <FileTextOutlined />,
  PERFORMANCE: <TeamOutlined />,
  CUSTOM: <SettingOutlined />,
};

const TYPE_COLOR: Record<string, string> = {
  FINANCIAL: "blue",
  BUSINESS: "green",
  PERFORMANCE: "purple",
  CUSTOM: "orange",
};

type Definition = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  periodType: string;
  defaultMetrics: Array<{ key: string; label: string; unit: string }>;
  dimensions: string[];
};

type Snapshot = {
  id: string;
  definitionCode: string;
  definitionName: string;
  periodType: string;
  periodLabel: string;
  status: string;
  generatedAt: string;
  generatedByName: string;
};

export default function ReportsPage() {
  const { isMobile } = useResponsive();
  const [defs, setDefs] = useState<Definition[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [defsRes, snapsRes] = await Promise.all([
        fetch("/api/reports/definitions", { credentials: "include" }),
        fetch("/api/reports/snapshots?limit=20", { credentials: "include" }),
      ]);
      const defsJson = await defsRes.json();
      const snapsJson = await snapsRes.json();
      if (defsJson.code !== 0) throw new Error(defsJson.message);
      if (snapsJson.code !== 0) throw new Error(snapsJson.message);
      setDefs(defsJson.data);
      setSnapshots(snapsJson.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const latestSnapshot = (code: string) =>
    snapshots.find((s) => s.definitionCode === code);

  return (
    <Page>
      <PageHeader
        title="报表中心"
        subtitle="按月、季、年自动生成经营报表，支持自定义日期范围与手动重新生成"
        actions={
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
        }
      />

      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {defs.map((def) => {
              const snap = latestSnapshot(def.code);
              return (
                <Col key={def.id} xs={24} sm={12} lg={8}>
                  <Link href={`/reports/${def.code}`} style={{ textDecoration: "none" }}>
                    <Card
                      hoverable
                      loading={loading && defs.length === 0}
                      title={
                        <span>
                          {TYPE_ICON[def.type]} <span style={{ marginLeft: 8 }}>{def.name}</span>
                        </span>
                      }
                      extra={<Tag color={TYPE_COLOR[def.type]}>{reportPeriodLabel(def.periodType)}</Tag>}
                    >
                      <p style={{ color: "#6b7280", minHeight: 40 }}>
                        {def.description ?? "-"}
                      </p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>
                          指标: {def.defaultMetrics.map((m) => m.label).join(" / ")}
                        </span>
                        {snap ? (
                          <Tag color={snap.status === "READY" ? "success" : "warning"}>
                            {snap.periodLabel} · {reportStatusLabel(snap.status)}
                          </Tag>
                        ) : (
                          <Tag>未生成</Tag>
                        )}
                      </div>
                      {snap && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                          最近生成: {new Date(snap.generatedAt).toLocaleString("zh-CN")} · {snap.generatedByName}
                        </div>
                      )}
                    </Card>
                  </Link>
                </Col>
              );
            })}
          </Row>

          {defs.length === 0 && !loading && (
            <Empty description="暂无报表模板" style={{ marginTop: 48 }} />
          )}

          <div style={{ marginTop: 32 }}>
            <PageHeader level="section" title="最近生成的快照" />
            <Spin spinning={loading}>
              <Row gutter={[16, 16]}>
                {snapshots.slice(0, isMobile ? 4 : 6).map((snap) => (
                  <Col key={snap.id} xs={24} sm={12} lg={8}>
                    <Link href={`/reports/${snap.definitionCode}`} style={{ textDecoration: "none" }}>
                      <Card size="small" title={snap.definitionName} hoverable>
                        <div>周期: {snap.periodLabel}</div>
                        <div>
                          状态:{" "}
                          <Tag color={snap.status === "READY" ? "success" : "warning"}>
                            {reportStatusLabel(snap.status)}
                          </Tag>
                        </div>
                        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                          {new Date(snap.generatedAt).toLocaleString("zh-CN")}
                        </div>
                      </Card>
                    </Link>
                  </Col>
                ))}
                {snapshots.length === 0 && !loading && (
                  <Empty description="暂无快照" style={{ margin: "24px auto" }} />
                )}
              </Row>
            </Spin>
          </div>
        </>
      )}
    </Page>
  );
}
