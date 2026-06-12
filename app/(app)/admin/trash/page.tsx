"use client";
// P13: 回收站 — 查看和恢复已软删除的记录
import useSWR from "swr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App as AntdApp, Button, Empty, Modal, Popconfirm, Skeleton, Space, Table, Tag, Typography } from "antd";
import { UndoOutlined, DeleteOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type TrashItem = {
  id: string;
  entityType: string;
  name: string;
  deletedAt: string;
};

const ENTITY_LABEL: Record<string, string> = {
  Customer: "客户",
  Contract: "合同",
  Project: "项目",
  Invoice: "发票",
  Payment: "回款",
  WorkflowTemplate: "工作流模板"
};

const ENTITY_TONE: Record<string, string> = {
  Customer: "blue",
  Contract: "green",
  Project: "orange",
  Invoice: "purple",
  Payment: "gold",
  WorkflowTemplate: "cyan"
};

export default function TrashPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { message, notification } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<TrashItem[]>("/api/admin/trash");
  const [restoring, setRestoring] = useState<string | null>(null);

  const handleRestore = async (entityType: string, id: string) => {
    setRestoring(id);
    try {
      const res = await fetch("/api/admin/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, id })
      });
      const j = await res.json();
      if (j.code !== 0) {
        message.error(j.message || "恢复失败");
        return;
      }
      notification.success({ message: `已恢复「${j.data.name}」`, placement: "topRight" });
      mutate();
    } catch {
      message.error("恢复请求失败");
    } finally {
      setRestoring(null);
    }
  };

  const columns: ColumnsType<TrashItem> = [
    {
      title: "类型",
      dataIndex: "entityType",
      width: 120,
      render: (t: string) => <Tag color={ENTITY_TONE[t]}>{ENTITY_LABEL[t] || t}</Tag>
    },
    {
      title: "名称/编号",
      dataIndex: "name",
      ellipsis: true
    },
    {
      title: "删除时间",
      dataIndex: "deletedAt",
      width: 180,
      render: (v: string) => <Text type="secondary">{new Date(v).toLocaleString("zh-CN")}</Text>
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, r) => (
        <Popconfirm
          title={`确定要恢复「${r.name}」吗？`}
          onConfirm={() => handleRestore(r.entityType, r.id)}
          okText="恢复"
          cancelText="取消"
        >
          <Button
            type="link"
            size="small"
            icon={<UndoOutlined />}
            loading={restoring === r.id}
            disabled={restoring !== null}
          >
            恢复
          </Button>
        </Popconfirm>
      )
    }
  ];

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="回收站" subtitle="恢复已删除的数据" />
        <Skeleton active />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="回收站"
        subtitle="查看和恢复已删除的数据（客户/合同/项目/发票/回款/工作流模板）"
      />

      {!data || data.length === 0 ? (
        <Empty
          description="回收站为空,暂无已删除的记录"
          style={{ marginTop: 40 }}
        >
          <Button type="primary" onClick={() => router.back()}>返回</Button>
        </Empty>
      ) : (
        <Table
          rowKey={(r) => `${r.entityType}-${r.id}`}
          columns={columns}
          dataSource={data}
          size={isMobile ? "small" : "middle"}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      )}
    </Page>
  );
}
