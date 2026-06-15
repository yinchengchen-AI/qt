"use client";
import { Card, Col, Row, Statistic, Tag, Button, Empty, List, Space, Spin } from "antd";
import { DatabaseOutlined, FileAddOutlined, UploadOutlined, WarningOutlined, ClockCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import Link from "next/link";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
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
  const { data: stats, isLoading: loadingStats } = useSWR<Stats>("/api/assets/stats");
  const { data: expiring, isLoading: loadingExp } = useSWR<ExpiringRow[]>("/api/assets/expiring-soon?limit=10");
  const { data: session } = useSWR<{ user: { roleCode: string } }>("/api/auth/me");
  const isAdmin = session?.user?.roleCode === "ADMIN";

  return (
    <Page>
      <PageHeader
        title="企业资产"
        subtitle="统一管理营业执照 / 资质 / 业绩 / 团队 / 案例 / 专利 等企业素材"
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
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="资产总数" value={stats?.total ?? 0} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={`即将到期(${stats?.expiringSoonDays ?? 60} 天内)`}
                value={stats?.expiringSoonCount ?? 0}
                prefix={<ClockCircleOutlined style={{ color: "#faad14" }} />}
                valueStyle={{ color: "#faad14" }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="已过期"
                value={stats?.expiredCount ?? 0}
                prefix={<CloseCircleOutlined style={{ color: "#f5222d" }} />}
                valueStyle={{ color: "#f5222d" }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="已归档"
                value={stats?.byStatus?.ARCHIVED ?? 0}
                prefix={<WarningOutlined style={{ color: "#999" }} />}
              />
            </Card>
          </Col>
        </Row>
      </Spin>

      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Card title={`即将到期(${stats?.expiringSoonCount ?? 0})`} extra={<Link href="/assets/list?status=EXPIRING_SOON">查看全部</Link>}>
            <Spin spinning={loadingExp}>
              {expiring && expiring.length > 0 ? (
                <List
                  dataSource={expiring}
                  renderItem={(row) => {
                    const dl = daysLeft(row.validTo);
                    return (
                      <List.Item
                        actions={[<Link key="view" href={`/assets/${row.id}`}>查看</Link>]}
                      >
                        <List.Item.Meta
                          title={
                            <Space>
                              <Link href={`/assets/${row.id}`}>{row.name}</Link>
                              <Tag>{ASSET_TYPE_MAP[row.type] ?? row.type}</Tag>
                              <Tag color={dl != null && dl <= 7 ? "red" : "orange"}>
                                {dl != null ? `${dl} 天后到期` : "已过期"}
                              </Tag>
                            </Space>
                          }
                          description={
                            <span style={{ color: "#999" }}>
                              {row.code} · 到期: {row.validTo ? new Date(row.validTo).toISOString().slice(0, 10) : "—"}
                            </span>
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty description="暂无即将到期的资产" />
              )}
            </Spin>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="类型分布">
            <Spin spinning={loadingStats}>
              {stats && (
                <div>
                  {ASSET_TYPE.map((t) => (
                    <Row key={t} align="middle" style={{ marginBottom: 8 }}>
                      <Col span={10}>{ASSET_TYPE_MAP[t] ?? t}</Col>
                      <Col span={10}>
                        <div style={{ background: "#f0f0f0", height: 12, borderRadius: 6, overflow: "hidden" }}>
                          <div
                            style={{
                              background: "#1677ff",
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
          </Card>
        </Col>
      </Row>
    </Page>
  );
}
