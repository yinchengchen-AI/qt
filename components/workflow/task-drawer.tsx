"use client";
// P5: 任务实例抽屉
// 内容: 完整信息 + 状态机操作 + 备注编辑 + 附件上传/列表
// 活动历史已移至项目详情页(/projects/{id})的 ProjectHistory 组件
import { useState } from "react";
import { App as AntdApp, Button, Drawer, Space, Tag, Typography, Upload } from "antd";
import {
  CheckCircleOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  StopOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_TASK_STATUS_MAP,
  WORKFLOW_REVIEW_STATUS_MAP,
  WORKFLOW_RECURRENCE_UNIT_MAP
} from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";
import { useUserName } from "@/lib/user-lookup";
import { useRoleNameMap } from "@/lib/role-lookup";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import { uploadFileToMinIO } from "@/lib/upload-client";

const { Text, Title } = Typography;
import { Input } from "antd";
const { TextArea } = Input;

type Attachment = { id: string; name: string; mimeType: string; size: number; uploadedBy?: string; uploadedAt?: string };

type TaskInstance = {
  id: string;
  code?: string;
  name?: string;
  description?: string | null;
  taskName?: string;
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
  reviewStatus?: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
  assigneeId?: string | null;
  requiredRole?: string | null;
  requiresDeliverable?: boolean;
  requiresOnsite?: boolean;
  requiresTwoStepReview?: boolean;
  isRecurring?: boolean;
  recurrenceUnit?: string | null;
  recurrenceInterval?: number | null;
  estimateDays?: number | null;
  remark?: string | null;
  attachments?: unknown;
  phase?: string;
  projectId?: string;
  projectNo?: string;
  projectName?: string;
  completedAt?: string | null;
  reviewedAt?: string | null;
  parentInstanceId?: string | null;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  SKIPPED: "warning",
  BLOCKED: "error"
};

function readAttachments(att: unknown): Attachment[] {
  if (!att) return [];
  if (Array.isArray(att)) return att as Attachment[];
  if (typeof att === "object") {
    const items = (att as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Attachment[];
  }
  return [];
}

export function TaskDrawer({
  task,
  open,
  onClose,
  onChanged,
  canEdit
}: {
  task: TaskInstance | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  canEdit: boolean;
}) {
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const roleNameMap = useRoleNameMap();
  const assigneeName = useUserName(task?.assigneeId ?? null, "未指派");
  const [busy, setBusy] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!task || !open) return null;

  const callTask = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/workflow-tasks/${task.id}${path}`, {
        method: path === "/assign" || path === "/remark" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code !== 0) { message.error(j.message); return false; }
      onChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRemark = async () => {
    if (remarkDraft === null) return;
    const ok = await callTask("/remark", { remark: remarkDraft });
    if (ok) message.success("备注已保存");
  };

  // 附件上传:先调 uploadFileToMinIO 走 tmp/ 路径上传到 MinIO,
  // 再 POST 到 /api/workflow-tasks/{id}/attachments 关联到当前任务
  const handleUpload = async (file: File): Promise<boolean> => {
    setUploading(true);
    try {
      const res = await uploadFileToMinIO(file, {});
      const link = await fetch(`/api/workflow-tasks/${task.id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attachmentId: res.id })
      });
      const linkJ = await link.json();
      if (linkJ.code !== 0) throw new Error(linkJ.message || "关联到任务失败");
      message.success("已上传");
      onChanged?.();
      return false; // antd: false = 阻止默认上传
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      setUploading(false);
    }
  };

  // 自定义删除:既移除 task JSON 关联,又软删 Attachment 记录
  const handleDeleteAttachment = async (item: AttachmentItem): Promise<void> => {
    const r = await fetch(`/api/workflow-tasks/${task.id}/attachments/${item.id}`, {
      method: "DELETE",
      credentials: "include"
    });
    const j = await r.json();
    if (j.code !== 0) throw new Error(j.message || "删除失败");
    message.success("已删除");
    onChanged?.();
  };

  const attachments = readAttachments(task.attachments);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement={isMobile ? "bottom" : "right"}
      size={isMobile ? "100%" : 760}
      height={isMobile ? "92%" : undefined}
      styles={isMobile ? { body: { paddingBottom: 24 } } : undefined}
      title={
        <Space>
          {task.status && <Tag color={STATUS_TONE[task.status]}>{WORKFLOW_TASK_STATUS_MAP[task.status]}</Tag>}
          <span>{task.name ?? task.taskName ?? "任务详情"}</span>
        </Space>
      }
      destroyOnHidden
    >
      {/* 任务基础信息 */}
      <Title level={5} style={{ marginTop: 0 }}>任务信息</Title>
      <Space size={4} wrap style={{ marginBottom: 8 }}>
        <Tag>{task.code}</Tag>
        <Tag color="blue">{task.phase ? (WORKFLOW_PHASE_MAP[task.phase] ?? task.phase) : "—"}</Tag>
        {task.requiredRole && <Tag>{roleNameMap[task.requiredRole] ?? task.requiredRole}</Tag>}
        {task.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
        {task.requiresOnsite && <Tag color="gold">现场</Tag>}
        {task.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
        {task.isRecurring && (
          <Tag color="geekblue">每 {task.recurrenceInterval ?? 1} {WORKFLOW_RECURRENCE_UNIT_MAP[task.recurrenceUnit ?? ""] ?? task.recurrenceUnit}</Tag>
        )}
        {task.estimateDays && <Tag>预估 {task.estimateDays} 天</Tag>}
      </Space>
      {task.description && <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>{task.description}</Text>}

      <Space size={4} wrap style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>所属项目:</Text>
        <Text style={{ fontSize: 12 }}>{task.projectName} · {task.projectNo}</Text>
      </Space>

      {/* 上下文摘要:补回卡片上收掉的信息 */}
      <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fafafa", borderRadius: 6 }}>
        <Space size={[4, 4]} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>指派人:</Text>
          <Text style={{ fontSize: 12 }}>{assigneeName}</Text>
          {task.reviewStatus && (
            <>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>审阅:</Text>
              <Text style={{ fontSize: 12 }}>{WORKFLOW_REVIEW_STATUS_MAP[task.reviewStatus] ?? task.reviewStatus}</Text>
            </>
          )}
          {task.completedAt && (
            <>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>完成于:</Text>
              <Text style={{ fontSize: 12 }}>{new Date(task.completedAt).toLocaleString("zh-CN")}</Text>
            </>
          )}
          {task.reviewedAt && (
            <>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>审阅于:</Text>
              <Text style={{ fontSize: 12 }}>{new Date(task.reviewedAt).toLocaleString("zh-CN")}</Text>
            </>
          )}
        </Space>
      </div>

      {/* 状态机按钮 */}
      {canEdit && (
        <>
          <Title level={5}>操作</Title>
          <Space wrap size={6} style={{ marginBottom: 16 }}>
            {(task.status === "PENDING" || task.status === "BLOCKED") && (
              <Button type="primary" size="small" icon={<PlayCircleOutlined />} loading={busy} onClick={() => callTask("/action", { action: "start" })}>开始</Button>
            )}
            {task.status === "IN_PROGRESS" && (
              <>
                <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={busy} onClick={() => callTask("/action", { action: "complete" })}>完成</Button>
                <Button danger size="small" icon={<StopOutlined />} loading={busy} onClick={() => callTask("/action", { action: "block" })}>阻塞</Button>
              </>
            )}
            {task.status === "BLOCKED" && (
              <Button size="small" loading={busy} onClick={() => callTask("/action", { action: "unblock" })}>解阻</Button>
            )}
            {(task.status === "PENDING" || task.status === "BLOCKED") && (
              <Button size="small" onClick={() => callTask("/action", { action: "skip" })}>跳过</Button>
            )}
            {task.requiresTwoStepReview && task.status === "IN_PROGRESS" && (!task.reviewStatus || task.reviewStatus === "REJECTED") && (
              <Button size="small" icon={<ThunderboltOutlined />} loading={busy} onClick={() => callTask("/review", { action: "submit" })}>提交校核</Button>
            )}
            {task.requiresTwoStepReview && task.reviewStatus === "REVIEWING" && (
              <>
                <Button type="primary" size="small" loading={busy} onClick={() => callTask("/review", { action: "approve" })}>审核通过</Button>
                <Button danger size="small" loading={busy} onClick={() => callTask("/review", { action: "reject" })}>驳回</Button>
              </>
            )}
          </Space>
        </>
      )}

      {/* 备注 */}
      <Title level={5}>备注</Title>
      {canEdit ? (
        <Space orientation="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <TextArea
            rows={3}
            value={remarkDraft ?? task.remark ?? ""}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemarkDraft(e.target.value)}
            placeholder="备注 / 进度说明"
            maxLength={2000}
          />
          <Button
            icon={<SaveOutlined />}
            size="small"
            disabled={remarkDraft === null || remarkDraft === task.remark}
            onClick={handleSaveRemark}
            loading={busy}
          >
            保存备注
          </Button>
        </Space>
      ) : (
        <Text type="secondary">{task.remark ?? "(无)"}</Text>
      )}

      {/* 附件 */}
      <Title level={5}><PaperClipOutlined /> 附件</Title>
      {canEdit && (
        <Upload beforeUpload={handleUpload} showUploadList={false} accept="*/*" disabled={uploading}>
          <Button size="small" loading={uploading} style={{ marginBottom: 12 }}>上传附件</Button>
        </Upload>
      )}
      <AttachmentList
        items={attachments as AttachmentItem[]}
        allowDelete={canEdit}
        customDelete={canEdit ? handleDeleteAttachment : undefined}
        showHeader={false}
      />
    </Drawer>
  );
}
