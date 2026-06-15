"use client";
import { use } from "react";
import useSWR from "swr";
import { Button, Card, Col, Row, Space, Tabs, Tag, Empty, Spin, App as AntdApp } from "antd";
import { EditOutlined, DeleteOutlined, InboxOutlined, DownloadOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { AssetAttributesRenderer } from "@/components/assets/asset-type-renderers";
import { ASSET_TYPE_MAP } from "@/lib/enum-maps";

type Asset = {
  id: string;
  code: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  status: string;
  validFrom: string | null;
  validTo: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  attachments: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    objectKey: string;
    uploadedAt: string;
  }>;
};

type OperationLogRow = {
  id: string;
  actorId: string;
  action: string;
  at: string;
  diff: unknown;
};

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const { data, error, isLoading, mutate } = useSWR<Asset>(`/api/assets/${id}`);
  const { data: session } = useSWR<{ user: { roleCode: string } }>("/api/auth/me");
  const isAdmin = session?.user?.roleCode === "ADMIN";
  const { data: logs } = useSWR<{ list: OperationLogRow[] }>(`/api/operation-logs?entity=CompanyAsset&entityId=${id}&pageSize=50`);

  if (error) {
    return (
      <Page>
        <PageHeader back={() => router.push("/assets")} title="资产详情" />
        <div style={{ padding: 16, background: "#fff2f0", color: "#cf1322", borderRadius: 8 }}>
          加载失败: {(error as Error).message}
        </div>
      </Page>
    );
  }

  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/assets")} title="资产详情" />
        <Spin />
      </Page>
    );
  }

  const handleArchive = async () => {
    modal.confirm({
      title: "确认归档?",
      content: "归档后从默认列表中过滤(可在筛选中恢复)",
      onOk: async () => {
        const res = await fetch(`/api/assets/${id}/archive`, { method: "POST", credentials: "include" });
        const j = await res.json();
        if (j.code !== 0) { message.error(j.message); return; }
        message.success("已归档");
        mutate();
      }
    });
  };

  const handleDelete = async () => {
    modal.confirm({
      title: "确认删除?",
      content: "将进入回收站,可联系管理员恢复",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await fetch(`/api/assets/${id}`, { method: "DELETE", credentials: "include" });
        const j = await res.json();
        if (j.code !== 0) { message.error(j.message); return; }
        message.success("已删除");
        router.push("/assets");
      }
    });
  };

  return (
    <Page>
      <PageHeader
        back={() => router.push("/assets/list")}
        title={data.name}
        subtitle={
          <Space>
            <Tag>{ASSET_TYPE_MAP[data.type] ?? data.type}</Tag>
            <span style={{ color: "#999" }}>{data.code}</span>
            <StatusTag status={data.status} domain="asset" />
          </Space>
        }
        actions={
          isAdmin && (
            <Space>
              <Button icon={<EditOutlined />} onClick={() => router.push(`/assets/${id}/edit`)}>编辑</Button>
              <Button icon={<InboxOutlined />} onClick={handleArchive}>归档</Button>
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>删除</Button>
            </Space>
          )
        }
      />
      <Tabs
        defaultActiveKey="info"
        items={[
          {
            key: "info",
            label: "基本信息",
            children: (
              <Row gutter={16}>
                <Col xs={24} md={14}>
                  <Card title="类型特定字段">
                    <AssetAttributesRenderer type={data.type} attributes={data.attributes} />
                  </Card>
                </Col>
                <Col xs={24} md={10}>
                  <Card title="基础信息">
                    <Row gutter={[8, 8]}>
                      <Col span={8} style={{ color: "#999" }}>编号</Col>
                      <Col span={16}>{data.code}</Col>
                      <Col span={8} style={{ color: "#999" }}>生效日期</Col>
                      <Col span={16}>{data.validFrom ? new Date(data.validFrom).toISOString().slice(0, 10) : "—"}</Col>
                      <Col span={8} style={{ color: "#999" }}>到期日期</Col>
                      <Col span={16}>{data.validTo ? new Date(data.validTo).toISOString().slice(0, 10) : "—"}</Col>
                      <Col span={8} style={{ color: "#999" }}>标签</Col>
                      <Col span={16}>
                        {(data.tags ?? []).length > 0
                          ? (data.tags ?? []).map((t) => <Tag key={t}>{t}</Tag>)
                          : "—"}
                      </Col>
                      <Col span={8} style={{ color: "#999" }}>说明</Col>
                      <Col span={16}>{data.description || "—"}</Col>
                      <Col span={8} style={{ color: "#999" }}>创建时间</Col>
                      <Col span={16}>{new Date(data.createdAt).toISOString().slice(0, 19).replace("T", " ")}</Col>
                      <Col span={8} style={{ color: "#999" }}>更新时间</Col>
                      <Col span={16}>{new Date(data.updatedAt).toISOString().slice(0, 19).replace("T", " ")}</Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: "attachments",
            label: `附件(${data.attachments?.length ?? 0})`,
            children: (
              <Card>
                {data.attachments && data.attachments.length > 0 ? (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {data.attachments.map((a) => (
                      <Row key={a.id} align="middle" gutter={8}>
                        <Col flex="auto">
                          <strong>{a.originalName}</strong>
                          <span style={{ color: "#999", marginLeft: 8 }}>{(a.size / 1024).toFixed(1)} KB · {a.mimeType}</span>
                        </Col>
                        <Col>
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={async () => {
                              const res = await fetch(`/api/assets/attachments/${a.id}/download`, { credentials: "include" });
                              const j = await res.json();
                              if (j.code === 0 && j.data?.url) {
                                window.open(j.data.url, "_blank");
                              } else {
                                message.error(j.message ?? "下载链接获取失败");
                              }
                            }}
                          >下载</Button>
                        </Col>
                      </Row>
                    ))}
                  </Space>
                ) : (
                  <Empty description="暂无附件" />
                )}
              </Card>
            )
          },
          {
            key: "usage",
            label: "引用记录",
            children: (
              <Card>
                <Empty description="暂无引用,投标模块上线后启用" />
              </Card>
            )
          },
          {
            key: "logs",
            label: `操作日志(${logs?.list?.length ?? 0})`,
            children: (
              <Card>
                {logs?.list && logs.list.length > 0 ? (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {logs.list.map((l) => (
                      <div key={l.id} style={{ borderBottom: "1px dashed #f0f0f0", paddingBottom: 8 }}>
                        <Space>
                          <Tag color="blue">{l.action}</Tag>
                          <span style={{ color: "#999" }}>{new Date(l.at).toISOString().slice(0, 19).replace("T", " ")}</span>
                        </Space>
                        {l.diff ? (
                          <pre style={{ marginTop: 4, fontSize: 12, color: "#666", background: "#fafafa", padding: 8, borderRadius: 4, whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(l.diff, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Empty description="暂无操作日志" />
                )}
              </Card>
            )
          }
        ]}
      />
    </Page>
  );
}
