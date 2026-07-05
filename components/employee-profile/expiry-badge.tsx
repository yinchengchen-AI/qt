import { Tag } from "antd";
import { getExpiryStatus } from "@/lib/employee-profile-expiry";

type Props = { expiryDate: string | null };

/**
 * ֤�鵽�ڻ���,�� cron `runCertificateExpiryCheck` �� 30/15/7 ������ֵ����һ�¡�
 * - �ѹ���:��ɫ
 * - <= 7 ��:���
 * - <= 15 ��:��
 * - <= 30 ��:��
 * - > 30 ��:����ʾ
 */
const LEVEL_COLOR: Record<"critical" | "high" | "medium", string> = {
  critical: "volcano",
  high: "orange",
  medium: "gold"
};

export function ExpiryBadge({ expiryDate }: Props) {
  const status = getExpiryStatus(expiryDate);
  if (status.kind === "none") return null;
  if (status.kind === "expired") {
    return <Tag color="red">�ѹ��� {status.days} ��</Tag>;
  }
  return <Tag color={LEVEL_COLOR[status.level]}>{status.days} �����</Tag>;
}

export { getExpiryStatus } from "@/lib/employee-profile-expiry";
export type { ExpiryStatus, ExpiryLevel } from "@/lib/employee-profile-expiry";
