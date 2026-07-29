// AppRelease (应用更新记录) — service 回归测试
//
// 覆盖:
//   - getRelease / listReleases 只读流程(手工发布已移除,写入由 scripts/release/publish.ts 直写 Prisma)
//   - 软删记录对 getRelease / listReleases 不可见
//   - markReleaseRead 幂等 (重复调用 readAt 不变)
//   - getLatestUnreadRelease: 跨已读/未读的状态机
// DB 不可达时整组 skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getRelease,
  listReleases,
  markReleaseRead,
  getLatestUnreadRelease
} from "@/server/services/app-release";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
const createdIds: string[] = [];
const createdReadIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return adminUser;
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return salesUser;
};

/** 测试数据准备:手工发布入口已移除,直接用 Prisma 写(与 publish.ts 同路径) */
async function seedRelease(input: {
  version: string;
  title: string;
  summary: string;
  content: string;
  important?: boolean;
  publishedAt?: Date;
  deletedAt?: Date;
}) {
  const r = await prisma.appRelease.create({
    data: {
      version: input.version,
      title: input.title,
      summary: input.summary,
      content: input.content,
      important: input.important ?? false,
      source: "GIT_COMMITS",
      publishedById: buildAdmin().id,
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      ...(input.deletedAt ? { deletedAt: input.deletedAt } : {})
    }
  });
  createdIds.push(r.id);
  return r;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false } })
  ]);
  if (!adminRow || !salesRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES", permissions: [] };
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdReadIds.length > 0) {
      await prisma.appReleaseRead.deleteMany({ where: { id: { in: createdReadIds } } });
    }
    if (createdIds.length > 0) {
      await prisma.appRelease.deleteMany({ where: { id: { in: createdIds } } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

describe("AppRelease 只读流程", () => {
  it("getRelease 返回记录;软删后 404", guard(async () => {
    const r = await seedRelease({
      version: "vTEST-0.0.2",
      title: "软删测试",
      summary: "删完应该 404",
      content: "x"
    });
    const got = await getRelease(buildSales(), r.id);
    expect(got.id).toBe(r.id);
    await prisma.appRelease.update({ where: { id: r.id }, data: { deletedAt: new Date() } });
    await expect(getRelease(buildSales(), r.id)).rejects.toMatchObject({ status: 404 });
  }));

  it("listReleases 纯 publishedAt 倒序(important 不置顶);软删不可见", guard(async () => {
    const olderImportant = await seedRelease({
      version: "vTEST-older-important",
      title: "older important",
      summary: "旧但重要",
      content: "x",
      important: true,
      publishedAt: new Date(Date.now() - 60_000)
    });
    const newer = await seedRelease({
      version: "vTEST-newer",
      title: "newer",
      summary: "新但普通",
      content: "x"
    });
    const deleted = await seedRelease({
      version: "vTEST-deleted",
      title: "deleted",
      summary: "已删",
      content: "x",
      deletedAt: new Date()
    });
    const list = await listReleases(buildSales(), { page: 1, pageSize: 100 });
    const found = list.list.filter((x) => createdIds.includes(x.id));
    expect(found.length).toBeGreaterThanOrEqual(2);
    // important 不置顶:较新的普通记录排在较旧的重要记录前
    const ids = found.map((x) => x.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(olderImportant.id));
    // 软删记录不出现在列表
    expect(ids).not.toContain(deleted.id);
  }));
});

describe("AppReleaseRead 已读追踪", () => {
  it("markReleaseRead 幂等: 重复调用 readAt 不变", guard(async () => {
    const r = await seedRelease({
      version: "vTEST-read",
      title: "已读测试",
      summary: "x",
      content: "x"
    });
    const first = await markReleaseRead(buildSales(), r.id);
    createdReadIds.push(first.id);
    const second = await markReleaseRead(buildSales(), r.id);
    expect(second.id).toBe(first.id);
    expect(second.readAt.getTime()).toBe(first.readAt.getTime());
  }));

  it("getLatestUnreadRelease 已读后不再返回 r", guard(async () => {
    const r = await seedRelease({
      version: "vTEST-latest-unread",
      title: "即将被读",
      summary: "x",
      content: "x"
    });
    const before = await getLatestUnreadRelease(buildSales());
    expect(before).toBeTruthy();
    await markReleaseRead(buildSales(), r.id);
    const readRow = await prisma.appReleaseRead.findUnique({
      where: { userId_releaseId: { userId: buildSales().id, releaseId: r.id } }
    });
    if (readRow) createdReadIds.push(readRow.id);
    const after = await getLatestUnreadRelease(buildSales());
    if (after.release) {
      expect(after.release.id).not.toBe(r.id);
    } else {
      // 所有 release 都已读也算符合预期
      expect(after.release).toBeNull();
    }
  }));
});
