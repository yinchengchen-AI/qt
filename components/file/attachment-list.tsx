"use client";
import { useState } from "react";
import { App as AntdApp, Empty, Space, Typography, Button, Popconfirm, Tag } from "antd";
import { DownloadOutlined, DeleteOutlined, EyeOutlined } from "@ant-design/icons";
import { FileKindBadge, formatBytes } from "./file-icon";
import { FilePreviewModal, type PreviewableAttachment } from "./file-preview-modal";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

export type AttachmentItem = PreviewableAttachment & {
  // 历史假链接 URL(placeholder.local)用于显示"历史链接已失效"
  legacyUrl?: string;
};

export function AttachmentList(props: {
  items: AttachmentItem[];
  // 是否显示删除按钮(详情页=可删;其他场景可关)
  allowDelete?: boolean;
  // 是否允许预览(默认 true)
  allowPreview?: boolean;
  // 自定义"无附件"占位文案
  emptyText?: string;
  // 自定义"标题/行数"
  showHeader?: boolean;
  // 删除前回调(父组件先发 DELETE 请求,成功后再调 prop.onDeleted 让上层刷新)
  onDeleted?: (id: string) => void;
  // 自定义删除逻辑:返回 Promise;若提供则用它替代默认的 DELETE /api/files/{id}
  // (例如任务抽屉需要走 /api/workflow-tasks/{taskId}/attachments/{attId})
  customDelete?: (item: AttachmentItem) => Promise<void>;
}) {
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const {
    items,
    allowDelete = true,
    allowPreview = true,
    emptyText = "暂无附件",
    showHeader = true,
    onDeleted,
    customDelete
  } = props;
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDownload = async (item: AttachmentItem) => {
    try {
      const r = await fetch(`/api/files/${item.id}/presign-download`, {
        method: "POST",
        credentials: "include"
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message || "下载失败");
      const a = document.createElement("a");
      a.href = j.data.url;
      a.download = j.data.originalName || item.name;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const handleDelete = async (item: AttachmentItem) => {
    setDeletingId(item.id);
    try {
      if (customDelete) {
        // 自定义删除(由父组件负责发请求 + 处理结果)
        await customDelete(item);
      } else {
        // 默认:软删 Attachment 记录(对象本身留 MinIO)
        const r = await fetch(`/api/files/${item.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        const j = await r.json();
        if (j.code !== 0) throw new Error(j.message || "删除失败");
      }
      void message.success("已删除");
      onDeleted?.(item.id);
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  if (!items || items.length === 0) {
    return (
      <div>
        {showHeader && (
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary">附件 (0)</Text>
          </div>
        )}
        <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div>
      {showHeader && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">附件 ({items.length})</Text>
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((a) => {
          const isLegacy = !!a.legacyUrl;
          return (
            <li
              key={a.id}
              style={{
                // 移动端允许换行:文件名 + 大小 折到上一行,操作按钮折到下一行
                display: "flex",
                alignItems: isMobile ? "flex-start" : "center",
                gap: 8,
                padding: isMobile ? "10px 0" : "6px 0",
                borderBottom: "1px dashed #f0f0f0",
                flexWrap: "wrap"
              }}
            >
              <FileKindBadge mime={a.mimeType} name={a.name} />
              {isLegacy ? (
                <Text type="secondary" style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>
                  {a.name}
                  <Tag color="default" style={{ marginLeft: 8 }}>
                    历史链接已失效
                  </Tag>
                </Text>
              ) : allowPreview ? (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPreview(a);
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                  title={a.name}
                >
                  <Text ellipsis={!isMobile} style={{ width: "100%", wordBreak: "break-all" }}>
                    {a.name}
                  </Text>
                </a>
              ) : (
                <Text style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>
                  {a.name}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                {formatBytes(a.size)}
              </Text>
              {!isLegacy && (
                <Space size={4} style={{ flexShrink: 0, marginLeft: isMobile ? "auto" : 0 }}>
                  {allowPreview && (
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setPreview(a)}
                      title="预览"
                    />
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownload(a)}
                    title="下载"
                  />
                  {allowDelete && (
                    <Popconfirm
                      title="确认删除此附件?"
                      description="删除后详情页不再显示,对象本身暂留 MinIO"
                      onConfirm={() => handleDelete(a)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingId === a.id}
                        title="删除"
                      />
                    </Popconfirm>
                  )}
                </Space>
              )}
            </li>
          );
        })}
      </ul>
      <FilePreviewModal attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
