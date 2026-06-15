"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal, Button, Spin, App as AntdApp, Result, Space, Typography, Tag, Table } from "antd";
import { DownloadOutlined, CloseOutlined, FileExcelOutlined } from "@ant-design/icons";
import { FileKindBadge, formatBytes, isPreviewable } from "./file-icon";

const { Text } = Typography;

export type PreviewableAttachment = {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
};

// Office 文件可走微软在线预览;需对象对外可达(预签 GET URL 满足)
const OFFICE_MIME = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
function isOffice(m: string) {
  return OFFICE_MIME.has(m);
}
function isCsv(m: string) {
  return m === "text/csv";
}
function isText(m: string) {
  return m === "text/plain";
}

// 极简 CSV 解析(不追求 RFC 4180 全覆盖,够看前 200 行就行):
//   - 字段以 " 或无引号包裹,内部逗号在引号内保留
//   - 行以 \n 或 \r\n 分隔
function parseCsv(input: string, maxRows = 200, maxCellChars = 200): { headers: string[]; rows: string[][]; truncated: boolean } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; if (out.length >= maxRows) break; }
      else if (c === "\r") { /* skip; \r\n handled by next \n */ }
      else { cell += c; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); out.push(row); }
  const truncated = out.length >= maxRows;
  const clipped = out.slice(0, maxRows).map((r) => r.map((c) => (c.length > maxCellChars ? c.slice(0, maxCellChars) + "…" : c)));
  return { headers: clipped[0] ?? [], rows: clipped.slice(1), truncated };
}

export function FilePreviewModal(props: {
  attachment: PreviewableAttachment | null;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const { attachment, onClose } = props;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // SSR 期 window 不存在;先给个保守默认值,挂载后再按视口收紧
  const [viewportWidth, setViewportWidth] = useState<number>(1000);
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // 拉 blob URL(只在 attachment 变化时重新拉);同时若 mime 是文本类,额外缓存解码后的字符串
  useEffect(() => {
    if (!attachment) {
      setBlobUrl(null);
      setText("");
      setErr(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErr(null);
    setText("");
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
        // 文本类直接解码,避免后续再 fetch
        if (isText(attachment.mimeType ?? "") || isCsv(attachment.mimeType ?? "")) {
          const buf = await blob.text();
          if (cancelled) return;
          setText(buf);
        }
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
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const isOfficeDoc = isOffice(mime);
  const isTextDoc = isText(mime);
  const isCsvDoc = isCsv(mime);

  // 解析 CSV(只在 text 变化时)
  const csvData = useMemo(() => {
    if (!isCsvDoc || !text) return null;
    return parseCsv(text);
  }, [isCsvDoc, text]);

  // Office 在线预览 URL(需要对象对外可达;预签 URL 5 分钟有效,够看完)
  const officeOnlineUrl = useMemo(() => {
    if (!isOfficeDoc || !blobUrl) return null;
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(blobUrl)}`;
  }, [isOfficeDoc, blobUrl]);

  // 文件预览分类(决定渲染哪种内容)
  const previewKind: "pdf" | "image" | "text" | "csv" | "office" | "none" =
    isPdf ? "pdf" : isImage ? "image" : isTextDoc ? "text" : isCsvDoc ? "csv" : isOfficeDoc ? "office" : "none";

  // PDF/图片也走 isPreviewable 的旧逻辑(对未识别的 image/* 也兜底);Office/Text/CSV 走新分支
  const canInlinePreview = isPreviewable(mime) || previewKind === "text" || previewKind === "csv" || previewKind === "office";

  return (
    <Modal
      open={!!attachment}
      onCancel={onClose}
      footer={null}
      width={Math.min(viewportWidth - 40, isPdf ? 1000 : 720)}
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

      {/* PDF */}
      {blobUrl && !loading && !err && previewKind === "pdf" && (
        <iframe
          src={blobUrl}
          title={attachment?.name}
          style={{ width: "100%", height: "70vh", border: "1px solid #f0f0f0" }}
        />
      )}

      {/* 图片 */}
      {blobUrl && !loading && !err && previewKind === "image" && (
        <div style={{ display: "flex", justifyContent: "center", background: "#fafafa", padding: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob URL 不能被 next/image 优化,需要原生 <img> */}
          <img
            src={blobUrl}
            alt={attachment?.name}
            style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
          />
        </div>
      )}

      {/* 纯文本(text/plain) */}
      {blobUrl && !loading && !err && previewKind === "text" && (
        <pre
          style={{
            maxHeight: "70vh",
            overflow: "auto",
            padding: 12,
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.5,
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          }}
        >
          {text || "(空文件)"}
        </pre>
      )}

      {/* CSV:解析为表格,前 200 行 */}
      {blobUrl && !loading && !err && previewKind === "csv" && csvData && (
        <div>
          <Table
            size="small"
            bordered
            scroll={{ y: "60vh", x: "max-content" }}
            pagination={false}
            dataSource={csvData.rows.map((r, i) => ({ key: i, _cells: r }))}
            columns={csvData.headers.map((h, i) => ({
              title: h || `(列 ${i + 1})`,
              dataIndex: "_cells",
              key: i,
              ellipsis: true,
              render: (cells: string[]) => cells[i] ?? ""
            }))}
          />
          {csvData.truncated && (
            <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
              仅显示前 200 行;完整内容请下载查看。
            </Text>
          )}
        </div>
      )}

      {/* Office 文件:给"在 Office Online 打开"链接(需对象对外可达)+ 下载 */}
      {blobUrl && !loading && !err && previewKind === "office" && (
        <Result
          icon={<FileExcelOutlined style={{ fontSize: 64, color: "#08979c" }} />}
          title="此 Office 文件无法在浏览器内直接预览"
          subTitle="可下载后用对应应用打开,或借助 Office Online 在线查看"
          extra={
            <Space>
              {officeOnlineUrl && (
                <Button type="primary" href={officeOnlineUrl} target="_blank" rel="noopener">
                  在 Office Online 打开
                </Button>
              )}
              <Button icon={<DownloadOutlined />} onClick={handleDownload}>
                下载 {attachment?.name}
              </Button>
            </Space>
          }
        />
      )}

      {/* 其它(zip / 不常见图片 / ...) — 给个能用的兜底 */}
      {blobUrl && !loading && !err && !canInlinePreview && (
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

      {attachment && canInlinePreview && (
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button icon={<DownloadOutlined />} onClick={handleDownload}>
            下载
          </Button>
        </div>
      )}
    </Modal>
  );
}
