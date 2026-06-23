// 企业资产库 定时任务
// - runAssetExpiryJob:扫所有非 ARCHIVED 资产,重算 status 写库(同步冗余列)
// - 30/7/1 天三档提醒,跟 contractExpiringJob 同样防重复模式
//   - 查 Message 表 today 内是否已有 type+assetId+daysLeft 记录
// - 给 asset.ownerUserId + 所有 ADMIN 发
import { prisma } from "@/lib/prisma";
import { emit } from "@/server/events/bus";
import { computeAssetStatus } from "@/lib/assets/status";
import type { JobResult } from "@/server/jobs/runner";

const TARGETS = [30, 7, 1] as const;

export async function runAssetExpiryJob(now: Date, admins?: { id: string }[]): Promise<JobResult> {
  const t0 = Date.now();
  let updated = 0;
  let notified = 0;
  let scanned = 0;
  // 1) 同步冗余 status 列
  const all = await prisma.companyAsset.findMany({
    where: { deletedAt: null, NOT: { status: "ARCHIVED" } },
    select: { id: true, status: true, validFrom: true, validTo: true }
  });
  for (const a of all) {
    const next = computeAssetStatus(a.validFrom, a.validTo, now);
    if (next !== a.status) {
      await prisma.companyAsset.update({ where: { id: a.id }, data: { status: next } });
      updated++;
    }
  }
  // 2) 30/7/1 天三档提醒
  for (const days of TARGETS) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const target = new Date(dayStart);
    target.setDate(target.getDate() + days);
    const candidates = await prisma.companyAsset.findMany({
      where: {
        deletedAt: null,
        NOT: { status: "ARCHIVED" },
        validTo: { gte: target, lt: dayEnd }
      },
      select: { id: true, code: true, name: true, type: true, validTo: true, ownerUserId: true }
    });
    scanned += candidates.length;
    const adminList = admins
      ?? (await prisma.user.findMany({
        where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", isSystem: false },
        select: { id: true }
      }));
    for (const a of candidates) {
      // 防重复:今天是否已发过同 daysLeft 提醒
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const exists = await prisma.message.findFirst({
        where: {
          type: "ASSET_EXPIRING",
          receiverUserId: a.ownerUserId,
          createdAt: { gte: todayStart },
          link: { path: ["id"], equals: a.id }
        }
      });
      if (exists) continue;
      await emit(prisma, {
        type: "ASSET_EXPIRING",
        payload: {
          assetId: a.id,
          assetCode: a.code,
          assetName: a.name,
          assetType: a.type,
          validTo: a.validTo,
          daysLeft: days
        },
        receivers: Array.from(new Set([a.ownerUserId, ...adminList.map((x) => x.id)]))
      });
      notified++;
    }
  }
  return {
    job: "asset-expiring",
    created: notified,
    scanned,
    updated,
    durationMs: Date.now() - t0
  };
}
