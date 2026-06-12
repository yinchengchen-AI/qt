"use client";
// P4: 工作流模板可视化编辑器(列表页)
import useSWR from "swr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App as AntdApp, Button, Card, Empty, Space, Tag, Tooltip, Typography } from "antd";
import { CopyOutlined, EditOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { SERVICE_TYPE_MAP } from "@/lib/enum-maps";

const { Text } = Typography;

type Template = {
  id: string;
  serviceType: string;
  name: string;
  version: number;
  isActive: boolean;
  description: string | null;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function WorkflowTemplatesPage() {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<Template[]>("/api/admin/workflow-templates");
  const [cloning, setCloning] = useState<string | null>(null);

  const handleClone = async (t: Template) => {
    modal.confirm({
      title: `克隆 ${t.name} 为新版本?`,
      content: "新版本会自增 version 号,旧版本自动 isActive=false。已有项目不受影响——它们用的是实例化时的快照。",
      okText: "确认克隆",
      onOk: async () => {
        setCloning(t.id);
        try {
          const r = await fetch(`/api/admin/workflow-templates/${t.id}/clone`, { method: "POST", credentials: "include" });
          const j = await r.json();
          if (j.code !== 0) {
            message.error(j.message);
            return;
          }
          message.success(`已克隆为 v${j.data.version}`);
          await mutate();
          router.push(`/admin/workflow-templates/${j.data.id}`);
        } finally {
          setCloning(null);
        }
      }
    });
  };

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="工作流模板" subtitle="按服务类型管理各阶段任务定义" />
        <Card loading />
      </Page>
    );
  }

  // 按 serviceType 分组,只显示每个 serviceType 的最新版本
  const byService = new Map<string, Template[]>();
  for (const t of data ?? []) {
    if (!byService.has(t.serviceType)) byService.set(t.serviceType, []);
    byService.get(t.serviceType)!.push(t);
  }
  for (const arr of byService.values()) arr.sort((a, b) => b.version - a.version);

  return (
    <Page>
      <PageHeader
        title="工作流模板"
        subtitle="按服务类型管理 5 阶段的任务定义。修改仅影响新实例化的项目。"
        actions={
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {byService.size} 类服务 · {data?.length ?? 0} 份模板
            </Text>
          </Space>
        }
      />

      {byService.size === 0 ? (
        <Empty description="暂无模板" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {Array.from(byService.entries()).map(([st, versions]) => {
            const latest = versions[0]!;
            return (
              <Card
                key={st}
                size="small"
                title={
                  <Space>
                    <Text strong>{SERVICE_TYPE_MAP[st] ?? st}</Text>
                    {latest.isActive && <Tag color="success">激活</Tag>}
                  </Space>
                }
                extra={
                  <Space>
                    <Tooltip title="克隆为新版本">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        loading={cloning === latest.id}
                        onClick={() => handleClone(latest)}
                      />
                    </Tooltip>
                    <Tooltip title="编辑">
                      <Button size="small" type="text" icon={<EditOutlined />} onClick={() => router.push(`/admin/workflow-templates/${latest.id}`)} />
                    </Tooltip>
                  </Space>
                }
              >
                <Text strong style={{ display: "block", marginBottom: 4 }}>{latest.name}</Text>
                <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
                  {latest.description ?? "(无描述)"}
                </Text>
                <Space size={4} wrap>
                  <Tag>v{latest.version}</Tag>
                  <Tag>{latest.stageCount} 阶段</Tag>
                  {versions.length > 1 && <Tag color="purple">{versions.length} 个历史版本</Tag>}
                </Space>
                {versions.length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>历史版本: </Text>
                    {versions.slice(1).map((v) => (
                      <Tag
                        key={v.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/admin/workflow-templates/${v.id}`)}
                      >
                        v{v.version}
                      </Tag>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
