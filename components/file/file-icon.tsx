"use client";
import {
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FileOutlined
} from "@ant-design/icons";
import type { CSSProperties } from "react";

// 常见 MIME → 颜色 + 图标名
// 颜色取自 antd 色板(红 PDF/蓝 Word/绿 Excel/紫 图片/灰 其他)
type IconKind = "pdf" | "word" | "excel" | "image" | "text" | "archive" | "other";
const KIND_MAP: Array<{ kinds: IconKind[]; match: (mime: string, ext: string) => boolean; color: string; bg: string }> = [
  { kinds: ["pdf"], match: (m) => m === "application/pdf", color: "#d4380d", bg: "#fff1f0" },
  { kinds: ["word"], match: (m) => m.includes("word") || m.includes("officedocument.wordprocessing"), color: "#1d39c4", bg: "#f0f5ff" },
  { kinds: ["excel"], match: (m) => m.includes("excel") || m.includes("officedocument.spreadsheet"), color: "#08979c", bg: "#e6fffb" },
  { kinds: ["image"], match: (m) => m.startsWith("image/"), color: "#722ed1", bg: "#f9f0ff" },
  { kinds: ["text"], match: (m) => m.startsWith("text/"), color: "#595959", bg: "#fafafa" },
  { kinds: ["archive"], match: (m) => m.includes("zip") || m.includes("rar") || m.includes("7z") || m.includes("tar") || m.includes("gz"), color: "#d48806", bg: "#fffbe6" }
];

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function classify(mime: string, name: string): IconKind {
  const m = (mime || "").toLowerCase();
  const e = extOf(name);
  for (const rule of KIND_MAP) {
    if (rule.match(m, e)) return rule.kinds[0] as IconKind;
  }
  // 退化到扩展名
  if (["pdf"].includes(e)) return "pdf";
  if (["doc", "docx"].includes(e)) return "word";
  if (["xls", "xlsx", "csv"].includes(e)) return "excel";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(e)) return "image";
  if (["txt", "md", "log"].includes(e)) return "text";
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "archive";
  return "other";
}

const ICON_FOR: Record<IconKind, typeof FilePdfOutlined> = {
  pdf: FilePdfOutlined,
  word: FileWordOutlined,
  excel: FileExcelOutlined,
  image: FileImageOutlined,
  text: FileTextOutlined,
  archive: FileZipOutlined,
  other: FileOutlined
};

const COLOR_FOR: Record<IconKind, string> = {
  pdf: "#d4380d",
  word: "#1d39c4",
  excel: "#08979c",
  image: "#722ed1",
  text: "#595959",
  archive: "#d48806",
  other: "#8c8c8c"
};

export function FileKindBadge(props: { mime?: string; name: string; size?: number; style?: CSSProperties }) {
  const kind = classify(props.mime ?? "", props.name);
  const Icon = ICON_FOR[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: COLOR_FOR[kind],
        ...props.style
      }}
    >
      <Icon style={{ fontSize: 18 }} />
    </span>
  );
}

export function formatBytes(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function isPreviewable(mime: string | undefined | null): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m === "application/pdf" || m.startsWith("image/");
}
