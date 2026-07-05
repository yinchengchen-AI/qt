// ֤�鵽�ڵ�λ (�� cron `runCertificateExpiryCheck` ��ֵ����һ��)
// - ������,ǰ��˹���,������ API ·���� import �ͻ������
// - ��ֵΪ"ʣ������ <= ��ֵ"ƥ��:7 / 15 / 30
// - expired = ʣ������ < 0
// - none    = ʣ������ > 30 (���ڹ�ע����)
export type ExpiryStatus =
  | { kind: "none" }
  | { kind: "expired"; days: number }
  | { kind: "warn"; level: "critical" | "high" | "medium"; days: number };

export type ExpiryLevel = "expired" | "critical" | "high" | "medium";

const LEVEL_TO_RANK: Record<ExpiryLevel, number> = {
  expired: 0,
  critical: 1,
  high: 2,
  medium: 3
};

export function getExpiryStatus(
  expiryDate: string | Date | null | undefined,
  now: Date = new Date()
): ExpiryStatus {
  if (!expiryDate) return { kind: "none" };
  const exp = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return { kind: "none" };
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { kind: "expired", days: Math.abs(days) };
  if (days <= 7) return { kind: "warn", level: "critical", days };
  if (days <= 15) return { kind: "warn", level: "high", days };
  if (days <= 30) return { kind: "warn", level: "medium", days };
  return { kind: "none" };
}

export function statusToLevel(status: ExpiryStatus): ExpiryLevel | null {
  if (status.kind === "none") return null;
  return status.kind === "expired" ? "expired" : status.level;
}

export function compareLevel(a: ExpiryLevel, b: ExpiryLevel): number {
  return LEVEL_TO_RANK[a] - LEVEL_TO_RANK[b];
}
