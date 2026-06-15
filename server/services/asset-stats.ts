// 企业资产库统计
// - 首页 4 张卡:总数 / 即将到期 / 已过期 / 类型分布
// - 状态用 computeAssetStatus 重算(避免 daily job 漏跑导致脏数据)
// - 性能:资产量级 < 5k 时 groupBy 一次拿全量,5k+ 走聚合查询(本期按 5k 估算)
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { computeAssetStatus, EXPIRING_SOON_DAYS } from "@/lib/assets/status";
import type { AssetType, AssetStatus } from "@/types/enums";
import { ASSET_TYPE } from "@/types/enums";

export type AssetStats = {
  total: number;
  byType: Record<AssetType, number>;
  byStatus: Record<AssetStatus, number>;
  expiringSoonCount: number;
  expiredCount: number;
  expiringSoonDays: number;
};

export async function getAssetStats(user: SessionUser): Promise<AssetStats> {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.READ);
  // 一次 groupBy 拿全量(状态在应用层重算)
  const grouped = await prisma.companyAsset.groupBy({
    by: ["type", "status"],
    where: { deletedAt: null },
    _count: { _all: true }
  });
  const now = new Date();
  // 真实有效/即将到期/已过期 计数(从每行重算)
  const all = await prisma.companyAsset.findMany({
    where: { deletedAt: null, NOT: { status: "ARCHIVED" } },
    select: { type: true, validFrom: true, validTo: true, status: true }
  });
  const byType: Record<string, number> = Object.fromEntries(ASSET_TYPE.map((t) => [t, 0]));
  const byStatus: Record<AssetStatus, number> = {
    VALID: 0, EXPIRING_SOON: 0, EXPIRED: 0, ARCHIVED: 0
  };
  let expiringSoonCount = 0;
  let expiredCount = 0;
  for (const a of all) {
    const live = computeAssetStatus(a.validFrom, a.validTo, now);
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    byStatus[live]++;
    if (live === "EXPIRING_SOON") expiringSoonCount++;
    if (live === "EXPIRED") expiredCount++;
  }
  // ARCHIVED 用 groupBy 计数(状态字段已是 ARCHIVED,无需重算)
  const archivedRow = grouped.find((g) => g.status === "ARCHIVED");
  byStatus.ARCHIVED = archivedRow?._count._all ?? 0;
  return {
    total: all.length + byStatus.ARCHIVED,
    byType: byType as Record<AssetType, number>,
    byStatus,
    expiringSoonCount,
    expiredCount,
    expiringSoonDays: EXPIRING_SOON_DAYS
  };
}

/** 即将到期列表(取最近 N 条) */
export async function listExpiringSoon(user: SessionUser, limit = 10) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.READ);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + EXPIRING_SOON_DAYS);
  const list = await prisma.companyAsset.findMany({
    where: {
      deletedAt: null,
      NOT: { status: "ARCHIVED" },
      validTo: { gte: new Date(), lte: cutoff }
    },
    orderBy: { validTo: "asc" },
    take: limit,
    select: {
      id: true, code: true, type: true, name: true,
      validTo: true, ownerUserId: true, status: true
    }
  });
  // 重算 status(避免 daily job 漏跑)
  const now = new Date();
  return list.map((a) => ({
    ...a,
    liveStatus: computeAssetStatus(a.validTo ? null : null, a.validTo, now)
  }));
}
