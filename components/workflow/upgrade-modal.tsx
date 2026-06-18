"use client";
// P8: 项目工作流升级 modal
// - 顶部: 当前 → 最新 模板名/version
// - 中部: 风险提示(force re-instantiate 会丢失所有实例状态)
// - 下部: 复用 diff page 渲染,显示 stage/task 增删改
import { App as AntdApp, Alert, Button, Empty, Modal, Skeleton, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import useSWR from "swr";
import { useState } from "react";

const { Text } = Typography;

type Diff = {
  from: { id: string; name: string; version: number; serviceType: string };
  to: { id: string; name: string; version: number; serviceType: string };
  stages: Array<{
    status: "added" | "removed" | "modified" | "unchanged";
    after: { name: string; phase: string } | null;
    before: { name: string; phase: string } | null;
    changes: string[];
    tasks: Array<{ status: "added" | "removed" | "modified" | "unchanged" }>;
  }>;
  totals: { added: number; removed: number; modified: number; unchanged: number };
};

type UpgradeCheck = {
  needsUpgrade: boolean;
  reason: "no-template" | "no-active-version" | "no-instances" | "same-version" | "older-version" | "already-latest";
  current: { id: string; name: string; version: number; taskCount: number; instanceCount: number } | null;
  latest: { id: string; name: string; version: number; taskCount: number } | null;
  serviceType: string | null;
  diff: Diff | null;
};

const STATUS_COLOR: Record<string, string> = {
  added: "green",
  removed: "red",
  modified: "orange",
  unchanged: "default"
};
const STATUS_LABEL: Record<string, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "未变"
};

export function UpgradeModal({
  projectId,
  open,
  onClose,
  onUpgraded
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onUpgraded: () => void;
}) {
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<UpgradeCheck>(
    open ? `/api/projects/${projectId}/workflow/upgrade-check` : null
  );
  const [busy, setBusy] = useState(false);

  const handleUpgrade = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/workflow/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force: true })
      });
      const j = await r.json();
      if (j.code !== 0) { message.error(j.message); return; }
      message.success(`已升级:重新生成 ${j.data.created} 个任务实例`);
      onUpgraded();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="升级项目工作流"
      width={720}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            danger
            loading={busy}
            disabled={!data?.needsUpgrade}
            onClick={handleUpgrade}
          >
            确认升级(覆盖当前 {data?.current?.instanceCount ?? 0} 个实例)
          </Button>
        </Space>
      }
    >
      {isLoading || !data ? (
        <Skeleton active />
      ) : !data.needsUpgrade ? (
        <Empty
          description={
            data.reason === "already-latest"
              ? "该项目已运行在最新模板,无需升级"
              : data.reason === "no-instances"
              ? "该项目尚未生成工作流实例,无需升级"
              : data.reason === "no-active-version"
              ? "服务类型下没有激活的模板"
              : "无法升级"
          }
        />
      ) : (
        <>
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            title="升级会丢失当前所有实例的状态"
            description={
              <Space orientation="vertical" size={2}>
                <Text>
                  当前 <Text strong>{data.current?.name}</Text> v
                  <Tag>{data.current?.version}</Tag>({data.current?.instanceCount} 实例)
                </Text>
                <Text>
                  升级到 <Text strong>{data.latest?.name}</Text> v
                  <Tag color="green">{data.latest?.version}</Tag>
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  所有 PENDING/IN_PROGRESS/REVIEWING 实例将重置为 PENDING,备注/附件/历史保留(但 taskId 引用变化)
                </Text>
              </Space>
            }
            style={{ marginBottom: 16 }}
          />
          {data.diff && (
            <Space orientation="vertical" size={8}>
              <Space size={4} wrap>
                <Tag color="green" icon={<ArrowRightOutlined />}>
                  +{data.diff.totals.added} 新增
                </Tag>
                <Tag color="red">−{data.diff.totals.removed} 删除</Tag>
                <Tag color="orange">~ {data.diff.totals.modified} 修改</Tag>
              </Space>
              {data.diff.stages.filter((s) => s.status !== "unchanged").map((s, i) => {
                const title = s.after?.name ?? s.before?.name ?? "?";
                return (
                  <div key={i} style={{ padding: 8, background: "#fafafa", borderRadius: 4, fontSize: 12 }}>
                    <Space size={4}>
                      <Tag color={STATUS_COLOR[s.status]}>{STATUS_LABEL[s.status]}</Tag>
                      <Text strong>{title}</Text>
                      {s.changes.length > 0 && <Tag color="orange">{s.changes.length} 字段</Tag>}
                      {s.tasks.length > 0 && <Tag>{s.tasks.length} 任务</Tag>}
                    </Space>
                  </div>
                );
              })}
            </Space>
          )}
        </>
      )}
    </Modal>
  );
}
