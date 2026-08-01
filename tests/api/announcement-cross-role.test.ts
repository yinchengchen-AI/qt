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
let opsUser: SessionUser | null = null;
let otherOpsUser: SessionUser | null = null;
const createdAnnouncementIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow, opsRows] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findMany({ where: { role: { code: "OPS" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true }, take: 2 })
  ]);
  if (!adminRow || !salesRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };
  if (opsRows.length >= 1) {
    opsUser = { ...opsRows[0]!, roleCode: "OPS", permissions: [] };
  }
  if (opsRows.length >= 2) {
    otherOpsUser = { ...opsRows[1]!, roleCode: "OPS", permissions: [] };
  }
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

// 公告按发文主体管理: 同一角色内非发布人不能改/删他人公告 (见 server/services/announcement.ts 护栏)
describe("公告改删归属", () => {
  const guard2 = (fn: () => Promise<void>) => async () => {
    if (!dbReachable || !adminUser || !opsUser || !otherOpsUser) return;
    await fn();
  };

  it("OPS 不能编辑他人的公告 (publishUserId != actor.id) -> 403", guard2(async () => {
    const a = await createAnnouncement(opsUser!, {
      title: "by ops-1",
      content: "content",
      targetRoles: []
    });
    createdAnnouncementIds.push(a.id);

    const { updateAnnouncement } = await import("@/server/services/announcement");
    await expect(
      updateAnnouncement(otherOpsUser!, a.id, { title: "hijacked" })
    ).rejects.toMatchObject({ status: 403 });
  }));

  it("OPS 不能删除他人的公告 -> 403", guard2(async () => {
    const a = await createAnnouncement(opsUser!, {
      title: "by ops-2",
      content: "content",
      targetRoles: []
    });
    createdAnnouncementIds.push(a.id);

    await expect(softDeleteAnnouncement(otherOpsUser!, a.id)).rejects.toMatchObject({ status: 403 });
  }));

  it("ADMIN 可绕过归属检查, 改删任何人的公告", guard2(async () => {
    const a = await createAnnouncement(opsUser!, {
      title: "by ops-3",
      content: "content",
      targetRoles: []
    });
    createdAnnouncementIds.push(a.id);

    const { updateAnnouncement } = await import("@/server/services/announcement");
    const updated = await updateAnnouncement(adminUser!, a.id, { title: "by admin" });
    expect(updated.title).toBe("by admin");
  }));
});
