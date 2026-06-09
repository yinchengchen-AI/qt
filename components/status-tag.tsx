import { Tag } from "antd";
import { formatStatus, type StatusDomain } from "@/lib/status";
import styles from "./status-tag.module.css";

const TONE_CLASS: Record<string, string> = {
  default:    styles.toneDefault ?? "",
  info:       styles.toneInfo ?? "",
  processing: styles.toneProcessing ?? "",
  success:    styles.toneSuccess ?? "",
  warning:    styles.toneWarning ?? "",
  danger:     styles.toneDanger ?? ""
};

type Props = {
  status: string | null | undefined;
  domain: StatusDomain;
  className?: string;
};

export function StatusTag({ status, domain, className }: Props) {
  const meta = formatStatus(status, domain);
  return (
    <Tag
      bordered={false}
      className={[styles.tag, TONE_CLASS[meta.tone] ?? "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {meta.label}
    </Tag>
  );
}
