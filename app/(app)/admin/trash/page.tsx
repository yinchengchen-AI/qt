
"use client";
// P13: 回收站 — 查看和恢复已软删除的记录
import useSWR from "swr";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App as AntdApp, Button, Empty, Popconfirm, Tag, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";
import { formatDateTime } from "@/lib/format";

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
  Invoice: "发票",
  Payment: "回款"
};

const ENTITY_TONE: Record<string, string> = {
  Customer: "blue",
  Contract: "green",
  Invoice: "purple",
  Payment: "gold"
};

export default function TrashPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { message, notification } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<TrashItem[]>("/api/admin/trash");
  const [restoring, setRestoring] = useState<string | null>(null);

  const handleRestore = useCallback(async (entityType: string, id: string) => {
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
      message.error("恢复请求失败，请稍后重试或联系管理员");
    } finally {
      setRestoring(null);
    }
  }, [message, notification, mutate]);

  const columns: ProColumns<TrashItem>[] = useMemo(
    () => [
      {
        title: "类型",
        dataIndex: "entityType",
        width: 120,
        render: (_, r) => <Tag color={ENTITY_TONE[r.entityType]}>{ENTITY_LABEL[r.entityType] || r.entityType}</Tag>
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
        render: (_, r) => <Text type="secondary">{formatDateTime(r.deletedAt)}</Text>
      },
      {
        title: "操作",
        key: "actions",
        width: 120,
        render: (_, r) => (
          <Popconfirm
            title={`确认恢复「${r.name}」？`}
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
    ],
    [restoring, handleRestore]
  );

  return (
    <Page>
      <PageHeader
        title="回收站"
        subtitle="查看和恢复已删除的数据：客户、合同、项目、发票、回款、工作流模板"
      />

      <ProTable<TrashItem>
        rowKey={(r) => `${r.entityType}-${r.id}`}
        columns={columns}
        dataSource={data ?? []}
        loading={isLoading}
        search={false}
        options={{ reload: () => mutate(), density: !isMobile, fullScreen: !isMobile }}
        scroll={{ x: "max-content" }}
        cardBordered={false}
        sticky={isMobile}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        locale={{
          emptyText: (
            <Empty description="回收站为空，暂无已删除的记录" style={{ marginTop: 24 }}>
              <Button type="primary" onClick={() => router.back()}>返回</Button>
            </Empty>
          )
        }}
      />
    </Page>
  );
}
