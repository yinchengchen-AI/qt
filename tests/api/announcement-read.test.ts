// 公告已读回执与阅读统计 — API/Service 回归测试
//
// 覆盖:
//   - markAnnouncementRead 幂等 (重复调用 readAt 不变)
//   - 越权: 公告 targetRoles 不含 SALES 时 SALES 上报返回 404
//   - 软删公告上报返回 404
//   - reads 名单: 发布人 / ADMIN 可查且内容正确, 无关 SALES 403
//   - listAnnouncements 返回当前用户 readAt
// DB 不可达时整组 skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  createAnnouncement,
  softDeleteAnnouncement,
  listAnnouncements,
  markAnnouncementRead,
  listAnnouncementReads
} from "@/server/services/announcement";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let opsUser: SessionUser | null = null;
const createdAnnouncementIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow, opsRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findFirst({ where: { role: { code: "OPS" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true } })
  ]);
  if (!adminRow || !salesRow || !opsRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };
  opsUser = { ...opsRow, roleCode: "OPS", permissions: [] };
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    // AnnouncementRead 走 FK Cascade 随公告硬删清理
    if (createdAnnouncementIds.length > 0) {
      await prisma.announcement.deleteMany({ where: { id: { in: createdAnnouncementIds } } });
    }
    await prisma.operationLog.deleteMany({ where: { entity: "Announcement", action: { in: ["ANNOUNCEMENT_CREATE", "ANNOUNCEMENT_DELETE"] } } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !opsUser) return;
  await fn();
};

describe("公告已读上报", () => {
  it("markAnnouncementRead 幂等: 重复调用 readAt 不变", guard(async () => {
    const a = await createAnnouncement(adminUser!, { title: "read idempotent", content: "x" });
    createdAnnouncementIds.push(a.id);

    const first = await markAnnouncementRead(salesUser!, a.id);
    const second = await markAnnouncementRead(salesUser!, a.id);
    expect(second.id).toBe(first.id);
    expect(second.readAt.getTime()).toBe(first.readAt.getTime());
  }));

  it("targetRoles 不含 SALES 时 SALES 上报返回 404", guard(async () => {
    const a = await createAnnouncement(adminUser!, {
      title: "admin only read",
      content: "x",
      targetRoles: ["ADMIN"]
    });
    createdAnnouncementIds.push(a.id);

    await expect(markAnnouncementRead(salesUser!, a.id)).rejects.toMatchObject({ status: 404 });
  }));

  it("软删公告上报返回 404", guard(async () => {
    const a = await createAnnouncement(adminUser!, { title: "soft deleted read", content: "x" });
    createdAnnouncementIds.push(a.id);
    await softDeleteAnnouncement(adminUser!, a.id);

    await expect(markAnnouncementRead(salesUser!, a.id)).rejects.toMatchObject({ status: 404 });
  }));
});

describe("公告已读名单", () => {
  it("发布人 / ADMIN 可查且内容正确; 无关 SALES 403", guard(async () => {
    const a = await createAnnouncement(opsUser!, { title: "reads list", content: "x" });
    createdAnnouncementIds.push(a.id);
    await markAnnouncementRead(salesUser!, a.id);

    const byPublisher = await listAnnouncementReads(opsUser!, a.id);
    expect(byPublisher.readCount).toBe(1);
    expect(byPublisher.total).toBeGreaterThanOrEqual(1);
    expect(byPublisher.unreadCount).toBe(byPublisher.total - byPublisher.readCount);
    expect(byPublisher.readers[0]).toMatchObject({
      userId: salesUser!.id,
      name: salesUser!.name,
      employeeNo: salesUser!.employeeNo
    });

    const byAdmin = await listAnnouncementReads(adminUser!, a.id);
    expect(byAdmin.readCount).toBe(1);

    await expect(listAnnouncementReads(salesUser!, a.id)).rejects.toMatchObject({ status: 403 });
  }));

  it("targetRoles 非空时分母按这些角色计算", guard(async () => {
    const a = await createAnnouncement(adminUser!, {
      title: "sales audience",
      content: "x",
      targetRoles: ["SALES"]
    });
    createdAnnouncementIds.push(a.id);

    const salesCount = await prisma.user.count({
      where: { deletedAt: null, status: "ACTIVE", isSystem: false, role: { code: { in: ["SALES"] } } }
    });
    const stats = await listAnnouncementReads(adminUser!, a.id);
    expect(stats.total).toBe(salesCount);
    expect(stats.readCount).toBe(0);
    expect(stats.unreadCount).toBe(salesCount);
  }));
});

describe("listAnnouncements 已读状态", () => {
  it("返回当前用户 readAt: 未读为 null, 上报后为时间戳", guard(async () => {
    const a = await createAnnouncement(adminUser!, { title: "list readAt", content: "x" });
    createdAnnouncementIds.push(a.id);

    const before = await listAnnouncements(salesUser!, { page: 1, pageSize: 100 });
    expect(before.list.find((x) => x.id === a.id)?.readAt ?? null).toBeNull();

    const read = await markAnnouncementRead(salesUser!, a.id);
    const after = await listAnnouncements(salesUser!, { page: 1, pageSize: 100 });
    const item = after.list.find((x) => x.id === a.id);
    expect(item?.readAt?.getTime()).toBe(read.readAt.getTime());
    expect(item?.readCount).toBeGreaterThanOrEqual(1);
    expect(item?.readTotal).toBeGreaterThanOrEqual(1);
  }));
});
