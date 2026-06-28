import { Tag } from "antd";

type Props = { expiryDate: string | null };

export function ExpiryBadge({ expiryDate }: Props) {
  if (!expiryDate) return null;
  const exp = new Date(expiryDate);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return <Tag color="red">已过期 {Math.abs(days)} 天</Tag>;
  if (days <= 30) return <Tag color="orange">{days} 天后到期</Tag>;
  return null;
}
