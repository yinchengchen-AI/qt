"use client";
import { useEffect, useState } from "react";
import { Modal, Button, Spin, App as AntdApp, Result, Space, Typography, Tag } from "antd";
import { DownloadOutlined, CloseOutlined } from "@ant-design/icons";
import { FileKindBadge, formatBytes, isPreviewable } from "./file-icon";

const { Text } = Typography;

export type PreviewableAttachment = {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
};

export function FilePreviewModal(props: {
  attachment: PreviewableAttachment | null;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const { attachment, onClose } = props;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 拉 blob URL(只在 attachment 变化时重新拉)
  useEffect(() => {
    if (!attachment) {
      setBlobUrl(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/files/${attachment.id}/presign-download`, {
          method: "POST",
          credentials: "include"
        });
        const j = await r.json();
        if (cancelled) return;
        if (j.code !== 0 || !j.data?.url) throw new Error(j.message || "获取预览链接失败");
        const resp = await fetch(j.data.url);
        if (cancelled) return;
        if (!resp.ok) throw new Error(`下载对象失败: HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    if (!attachment) return;
    try {
      const r = await fetch(`/api/files/${attachment.id}/presign-download`, {
        method: "POST",
        credentials: "include"
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message || "下载失败");
      // 用 a 标签 + download 属性强制下载(覆盖 Content-Disposition)
      const a = document.createElement("a");
      a.href = j.data.url;
      a.download = j.data.originalName || attachment.name;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const mime = attachment?.mimeType ?? "";
  const canPreview = isPreviewable(mime);
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  return (
    <Modal
      open={!!attachment}
      onCancel={onClose}
      footer={null}
      width={Math.min(window.innerWidth - 40, isPdf ? 1000 : 720)}
      destroyOnHidden
      title={
        attachment ? (
          <Space size="small">
            <FileKindBadge mime={attachment.mimeType} name={attachment.name} />
            <Text strong style={{ maxWidth: 480 }} ellipsis={{ tooltip: attachment.name }}>
              {attachment.name}
            </Text>
            <Tag color="default">{formatBytes(attachment.size)}</Tag>
          </Space>
        ) : null
      }
      closeIcon={<CloseOutlined />}
    >
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spin size="large" tip="加载中...">
            <div style={{ width: 200, height: 100 }} />
          </Spin>
        </div>
      )}
      {err && (
        <Result
          status="error"
          title="预览失败"
          subTitle={err}
          extra={
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
              直接下载
            </Button>
          }
        />
      )}
      {blobUrl && !loading && !err && canPreview && isPdf && (
        <iframe
          src={blobUrl}
          title={attachment?.name}
          style={{ width: "100%", height: "70vh", border: "1px solid #f0f0f0" }}
        />
      )}
      {blobUrl && !loading && !err && canPreview && isImage && (
        <div style={{ display: "flex", justifyContent: "center", background: "#fafafa", padding: 16 }}>
          <img
            src={blobUrl}
            alt={attachment?.name}
            style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
          />
        </div>
      )}
      {blobUrl && !loading && !err && !canPreview && (
        <Result
          icon={<FileKindBadge mime={attachment?.mimeType} name={attachment?.name ?? ""} style={{ fontSize: 64 }} />}
          title="该格式无法在浏览器内预览"
          subTitle="请下载后用对应应用打开"
          extra={
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
              下载 {attachment?.name}
            </Button>
          }
        />
      )}
      {attachment && (
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button icon={<DownloadOutlined />} onClick={handleDownload}>
            下载
          </Button>
        </div>
      )}
    </Modal>
  );
}
