"use client";
import { ProCard } from "@ant-design/pro-components";
import { Col, Flex, Row, Tag, Button, Empty, Space, Spin, theme } from "antd";
import { DatabaseOutlined, FileAddOutlined, UploadOutlined, WarningOutlined, ClockCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import Link from "next/link";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { ASSET_TYPE } from "@/types/enums";
import { ASSET_TYPE_MAP } from "@/lib/enum-maps";

type Stats = {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  expiringSoonCount: number;
  expiredCount: number;
  expiringSoonDays: number;
};

type ExpiringRow = {
  id: string;
  code: string;
  type: string;
  name: string;
  validTo: string | null;
  ownerUserId: string;
  status: string;
  liveStatus: string;
};

function daysLeft(validTo: string | null): number | null {
  if (!validTo) return null;
  const d = new Date(validTo);
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default function AssetsHomePage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { data: stats, isLoading: loadingStats } = useSWR<Stats>("/api/assets/stats");
  const { data: expiring, isLoading: loadingExp } = useSWR<ExpiringRow[]>("/api/assets/expiring-soon?limit=10");
  const { data: session } = useSWR<{ user: { roleCode: string } }>("/api/auth/me");
  const isAdmin = session?.user?.roleCode === "ADMIN";

  // KPI 卡片统一走 StatGrid, 颜色用 theme token
  const kpiItems: StatItem[] = [
    {
      label: "资产总数",
      value: stats?.total ?? 0,
      prefix: <DatabaseOutlined style={{ color: token.colorPrimary }} />,
      description: "按当前过滤集实时统计"
    },
    {
      label: `即将到期(${stats?.expiringSoonDays ?? 60} 天内)`,
      value: stats?.expiringSoonCount ?? 0,
      prefix: <ClockCircleOutlined style={{ color: token.colorWarning }} />,
      description: "需关注到期前 30 / 7 天内的资产"
    },
    {
      label: "已过期",
      value: stats?.expiredCount ?? 0,
      prefix: <CloseCircleOutlined style={{ color: token.colorError }} />,
      description: "尽快归档或更新有效期"
    },
    {
      label: "已归档",
      value: stats?.byStatus?.ARCHIVED ?? 0,
      prefix: <WarningOutlined style={{ color: token.colorTextTertiary }} />
    }
  ];

  return (
    <Page>
      <PageHeader
        title="企业资产"
        subtitle="标书素材库 · 统一管理资质 / 业绩 / 团队 / 案例 / 模板 / 证书"
        actions={
          <Space>
            <Button icon={<DatabaseOutlined />} onClick={() => router.push("/assets/list")}>资产列表</Button>
            {isAdmin && (
              <>
                <Button type="primary" icon={<FileAddOutlined />} onClick={() => router.push("/assets/new")}>录入资产</Button>
                <Button icon={<UploadOutlined />} onClick={() => router.push("/assets/admin/import")}>批量导入</Button>
              </>
            )}
          </Space>
        }
      />
      <Spin spinning={loadingStats}>
        <StatGrid items={kpiItems} columns={4} loading={loadingStats} />
      </Spin>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={14}>
          <ProCard
            title={`即将到期(${stats?.expiringSoonCount ?? 0})`}
            extra={<Link href="/assets/list?status=EXPIRING_SOON">查看全部</Link>}
          >
            <Spin spinning={loadingExp}>
              {expiring && expiring.length > 0 ? (
                <Flex vertical gap="small">
                  {expiring.map((row) => {
                    const dl = daysLeft(row.validTo);
                    return (
                      <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Space size={4} wrap>
                            <Link href={`/assets/${row.id}`}>{row.name}</Link>
                            <Tag>{ASSET_TYPE_MAP[row.type] ?? row.type}</Tag>
                            <Tag color={dl != null && dl <= 7 ? "red" : "orange"}>
                              {dl != null ? `${dl} 天后到期` : "已过期"}
                            </Tag>
                          </Space>
                          <div style={{ color: token.colorTextTertiary, marginTop: 4, fontSize: 12 }}>
                            {row.code} · 到期: {row.validTo ? new Date(row.validTo).toISOString().slice(0, 10) : "—"}
                          </div>
                        </div>
                        <Link href={`/assets/${row.id}`}>查看</Link>
                      </div>
                    );
                  })}
                </Flex>
              ) : (
                <Empty description="暂无即将到期的资产" />
              )}
            </Spin>
          </ProCard>
        </Col>
        <Col xs={24} md={10}>
          <ProCard title="类型分布">
            <Spin spinning={loadingStats}>
              {stats && (
                <div>
                  {ASSET_TYPE.map((t) => (
                    <Row key={t} align="middle" style={{ marginBottom: 8 }}>
                      <Col span={10}>{ASSET_TYPE_MAP[t] ?? t}</Col>
                      <Col span={10}>
                        <div style={{ background: token.colorFillSecondary, height: 12, borderRadius: 6, overflow: "hidden" }}>
                          <div
                            style={{
                              background: token.colorPrimary,
                              height: "100%",
                              width: `${stats.total > 0 ? Math.round((stats.byType[t] ?? 0) / stats.total * 100) : 0}%`
                            }}
                          />
                        </div>
                      </Col>
                      <Col span={4} style={{ textAlign: "right" }}>{stats.byType[t] ?? 0}</Col>
                    </Row>
                  ))}
                </div>
              )}
            </Spin>
          </ProCard>
        </Col>
      </Row>
    </Page>
  );
}