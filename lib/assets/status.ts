// 资产状态计算(纯函数,可被 vitest 直接 import)
// - 真理之源:computeAssetStatus 总是按当前时间算,不依赖数据库列
// - status 字段冗余存,由 daily job 同步,首页统计卡直接 groupBy
// - 修改阈值改顶部常量即可,无需翻代码
import type { AssetStatus } from "@/types/enums";

/** 距到期 ≤ 该天数为 EXPIRING_SOON */
export const EXPIRING_SOON_DAYS = 60;

export function computeAssetStatus(
  validFrom: Date | string | null | undefined,
  validTo: Date | string | null | undefined,
  now: Date = new Date()
): AssetStatus {
  if (!validTo) return "VALID";
  const to = validTo instanceof Date ? validTo : new Date(validTo);
  if (Number.isNaN(to.getTime())) return "VALID";
  const msPerDay = 86_400_000;
  const days = (to.getTime() - now.getTime()) / msPerDay;
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRING_SOON_DAYS) return "EXPIRING_SOON";
  return "VALID";
}

/** 给定 validTo 距 now 的天数(可负) */
export function daysUntil(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}
