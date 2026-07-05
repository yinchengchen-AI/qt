"use client";
import { ProCard, ProTable, type ProColumns, type ActionType } from "@ant-design/pro-components";
import { Card, Col, Row, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { useResponsive } from "@/lib/use-breakpoint";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useSession } from "next-auth/react";
import { ErrorBox } from "@/components/callout";
import { formatDate } from "@/lib/format";
import { useRef, useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import {
  type ExpiryLevel,
  compareLevel
} from "@/lib/employee-profile-expiry";

const { Text } = Typography;

type Row = {
  certificateId: string;
  userId: string;
  employeeNo: string;
  name: string;
  certName: string;
  certNumber: string | null;
  issuer: string | null;
  expiryDate: string;
  daysLeft: number;
  level: ExpiryLevel;
};

type ApiResp = {
  data: Row[];
  counts: Record<ExpiryLevel, number>;
  total: number;
};

const LEVEL_LABEL: Record<ExpiryLevel, string> = {
  expired: "已过期",
  critical: "7 天内",
  high: "15 天内",
  medium: "30 天内"
};

const LEVEL_COLOR: Record<ExpiryLevel, string> = {
  expired: "red",
  critical: "volcano",
  high: "orange",
  medium: "gold"
};

const LEVEL_OPTIONS: { value: "all" | "near" | ExpiryLevel; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "near", label: "30 天内" },
  { value: "expired", label: "已过期" },
  { value: "critical", label: "7 天内" },
  { value: "high", label: "15 天内" },
  { value: "medium", label: "30 天内" }
];

export default function ExpiringCertificatesPage() {
  const router = useRouter();
  const goBack = useGoBack("/admin/users");
  const { isMobile } = useResponsive();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  const [level, setLevel] = useState<"all" | "near" | ExpiryLevel>("near");
  const actionRef = useRef<ActionType>(undefined);

  // 默认拉一次用于概览卡(始终拉 60 天窗口,不做档位过滤,counts 总览)
  const { data: overview } = useSWR<ApiResp>(
    isAdmin ? "/api/certificates/expiring?days=60&level=all" : null,
    async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      return j.data;
    }
  );

  const counts = overview?.counts;

  const refresh = useCallback(() => {
    actionRef.current?.reload?.();
  }, []);

  useEffect(() => {
    refresh();
  }, [level, refresh]);

  if (!isAdmin) {
    return (
      <Page>
        <PageHeader back={goBack} title="到期证书" />
        <ErrorBox title="无权限">仅管理员可查询到期证书,请联系系统管理员</ErrorBox>
      </Page>
    );
  }

  const columns: ProColumns<Row>[] = [
    { title: "工号", dataIndex: "employeeNo", width: 100, fixed: isMobile ? undefined : "left" },
    { title: "姓名", dataIndex: "name", width: 100 },
    { title: "证书", dataIndex: "certName", width: 200, ellipsis: true },
    {
      title: "到期日期",
      dataIndex: "expiryDate",
      width: 140,
      render: (_, r) => formatDate(r.expiryDate)
    },
    {
      title: "档位",
      dataIndex: "level",
      width: 110,
      render: (_, r) => <Tag color={LEVEL_COLOR[r.level]}>{LEVEL_LABEL[r.level]}</Tag>
    },
    {
      title: "剩余天数",
      dataIndex: "daysLeft",
      width: 100,
      sorter: (a, b) => a.daysLeft - b.daysLeft,
      render: (_, r) => {
        if (r.daysLeft < 0) return <Text type="danger">{-r.daysLeft} 天前</Text>;
        return <Text>{r.daysLeft} 天</Text>;
      }
    },
    {
      title: "操作",
      valueType: "option",
      width: 100,
      render: (_, r) => [
        <a key="view" onClick={() => router.push(`/admin/users/${r.userId}#certs`)}>查看档案</a>
      ]
    }
  ];

  return (
    <Page>
      <PageHeader
        back={goBack}
        title="到期证书"
        subtitle="60 天内到期或已过期的证书(未到期的证书不在此列表)"
        actions={
          isMobile ? (
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as typeof level)}
              style={{ height: 32, borderRadius: 6, padding: "0 8px" }}
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : null
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {(Object.keys(LEVEL_LABEL) as ExpiryLevel[]).map((k, _i) => (
          <Col key={k} xs={12} sm={8} md={6} lg={4}>
            <Card
              size="small"
              hoverable
              onClick={() => setLevel(k)}
              styles={{ body: { padding: 12 } }}
              style={{
                cursor: "pointer",
                borderColor: level === k ? "var(--qt-primary)" : undefined,
                background: level === k ? "var(--qt-bg-soft)" : undefined
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>{LEVEL_LABEL[k]}</Text>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: LEVEL_COLOR[k] ? `var(--qt-${LEVEL_COLOR[k]})` : undefined }}>
                {counts?.[k] ?? 0}
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 6, fontWeight: 400 }}>份</Text>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <ProCard>
        <ProTable<Row>
          actionRef={actionRef}
          rowKey="certificateId"
          columns={columns}
          search={false}
          toolBarRender={() => [
            <select
              key="level"
              value={level}
              onChange={(e) => setLevel(e.target.value as typeof level)}
              style={{ height: 32, borderRadius: 6, padding: "0 8px" }}
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ]}
          request={async () => {
            const r = await fetch(`/api/certificates/expiring?days=60&level=${level}`, { credentials: "include" });
            const j = await r.json();
            if (j.code !== 0) throw new Error(j.message);
            const list: Row[] = (j.data?.data ?? []).slice().sort(
              (a: Row, b: Row) => compareLevel(a.level, b.level) || a.daysLeft - b.daysLeft
            );
            return { data: list, success: true, total: list.length };
          }}
          pagination={{ pageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
          scroll={{ x: "max-content" }}
          sticky={isMobile}
        />
      </ProCard>
    </Page>
  );
}
