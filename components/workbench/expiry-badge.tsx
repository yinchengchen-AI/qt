"use client";
import { Tag } from "antd";

const DAY_MS = 86_400_000;

export function expiryTone(endDate: string | Date | null | undefined): {
  color: string;
  label: string;
} {
  if (!endDate) return { color: "default", label: "—" };
  const diff = new Date(endDate).getTime() - Date.now();
  const days = Math.ceil(diff / DAY_MS);
  if (days < 0) return { color: "red", label: `逾期 ${Math.abs(days)} 天` };
  if (days <= 7) return { color: "orange", label: `${days} 天后到期` };
  if (days <= 30) return { color: "gold", label: `${days} 天后到期` };
  return { color: "green", label: `${days} 天后到期` };
}

/** 到期天数标签: 红=逾期, 橙=7 天内, 黄=30 天内, 绿=安全 */
export function ExpiryBadge({ endDate }: { endDate?: string | Date | null }) {
  const tone = expiryTone(endDate);
  return <Tag color={tone.color}>{tone.label}</Tag>;
}
