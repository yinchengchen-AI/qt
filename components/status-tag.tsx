import { Tag } from "antd";
import { formatStatus, type StatusDomain } from "@/lib/status";

type Props = {
  status: string | null | undefined;
  domain: StatusDomain;
  className?: string;
};

export function StatusTag({ status, domain, className }: Props) {
  const meta = formatStatus(status, domain);
  return (
    <Tag className={className} color={meta.tone} style={{ margin: 0 }}>
      {meta.label}
    </Tag>
  );
}
