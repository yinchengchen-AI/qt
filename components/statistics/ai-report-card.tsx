"use client";

import { useState } from "react";
import { ProCard } from "@ant-design/pro-components";
import { Alert, Button, Space, Tag, Typography } from "antd";
import type { RangePreset } from "@/lib/date-range";
import { fetchApiData } from "@/lib/fetch-api";
import type { AnalysisReport } from "@/lib/types/business-report";

type AiReportCardProps = {
  range?: RangePreset;
  from?: string;
  to?: string;
};

export function AiReportCard({ range, from, to }: AiReportCardProps) {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (range) qs.set("range", range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (force) qs.set("force", "1");
      setReport(await fetchApiData<AnalysisReport>(`/api/statistics/ai-report?${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProCard
      title="经营解读"
      style={{ marginBottom: 24 }}
      extra={(
        <Button size="small" loading={loading} onClick={() => void load(Boolean(report))}>
          {report ? "重新生成" : "生成经营解读"}
        </Button>
      )}
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {report?.notice ? <Alert type="warning" showIcon title={report.notice} /> : null}
        {report ? (
          <>
            <Space size="small" wrap>
              <Tag color={report.source === "AI" ? "blue" : "default"}>
                {report.source === "AI" ? "AI 生成" : "规则摘要"}
              </Tag>
              <Typography.Text type="secondary">
                生成时间：{new Date(report.generatedAt).toLocaleString("zh-CN")}
              </Typography.Text>
            </Space>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{report.summary}</Typography.Paragraph>
            <section aria-label="关键发现">
              <Typography.Text strong>关键发现</Typography.Text>
              <ul>
                {report.keyFindings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
            <section aria-label="跟进建议">
              <Typography.Text strong>跟进建议</Typography.Text>
              <ul>
                {report.recommendations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          </>
        ) : (
          <Typography.Text type="secondary">
            点击生成后，将基于当前授权范围内的指标生成解读
          </Typography.Text>
        )}
      </Space>
    </ProCard>
  );
}
