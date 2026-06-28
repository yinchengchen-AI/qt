// 公告跨角色可见性 API/Service 回归测试
//
// 覆盖:
//   - ADMIN 发布的 ADMIN-only 公告，SALES list 看不到、get 返回 404
//   - SALES 可见 targetRoles 包含 SALES 的公告
//   - 软删后 SALES 看不到
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  softDeleteAnnouncement
} from "@/server/services/announcement";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
const createdAnnouncementIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null }, select: { id: true, employeeNo: true, name: true, email: true } })
  ]);
  if (!adminRow || !salesRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
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
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

describe("公告跨角色可见性", () => {
  it("SALES 无法读取 ADMIN-only 公告", guard(async () => {
    const a = await createAnnouncement(adminUser!, {
      title: "Admin only",
      content: "confidential",
      targetRoles: ["ADMIN"]
    });
    createdAnnouncementIds.push(a.id);

    const list = await listAnnouncements(salesUser!, { page: 1, pageSize: 100 });
    expect(list.list.some((x) => x.id === a.id)).toBe(false);

    await expect(getAnnouncement(salesUser!, a.id)).rejects.toMatchObject({ status: 404 });
  }));

  it("SALES 可读取目标包含 SALES 的公告", guard(async () => {
    const a = await createAnnouncement(adminUser!, {
      title: "SALES visible",
      content: "content",
      targetRoles: ["SALES"]
    });
    createdAnnouncementIds.push(a.id);

    const got = await getAnnouncement(salesUser!, a.id);
    expect(got.id).toBe(a.id);

    const list = await listAnnouncements(salesUser!, { page: 1, pageSize: 100 });
    expect(list.list.some((x) => x.id === a.id)).toBe(true);
  }));

  it("软删后 SALES 看不到", guard(async () => {
    const a = await createAnnouncement(adminUser!, {
      title: "Will delete",
      content: "content",
      targetRoles: ["SALES"]
    });
    createdAnnouncementIds.push(a.id);
    await softDeleteAnnouncement(adminUser!, a.id);

    const list = await listAnnouncements(salesUser!, { page: 1, pageSize: 100 });
    expect(list.list.some((x) => x.id === a.id)).toBe(false);
  }));
});
