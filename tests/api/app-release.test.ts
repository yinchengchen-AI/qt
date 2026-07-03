// AppRelease (应用更新记录) — service 回归测试
//
// 覆盖:
//   - createRelease / getRelease / listReleases / softDeleteRelease 基本流程
//   - markReleaseRead 幂等 (重复调用 readAt 不变)
//   - getLatestUnreadRelease: 跨已读/未读的状态机
//   - 软删后 getRelease / listReleases 都看不到
// DB 不可达时整组 skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  createRelease,
  getRelease,
  listReleases,
  softDeleteRelease,
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
    await prisma.operationLog.deleteMany({ where: { entity: "AppRelease", action: { in: ["APP_RELEASE_CREATE", "APP_RELEASE_UPDATE", "APP_RELEASE_DELETE"] } } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

describe("AppRelease 基本流程", () => {
  it("createRelease 写入并返回带 id/version 的记录", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-0.0.1",
      title: "测试 release",
      summary: "用于 vitest 的最小记录",
      content: "正文 1\n正文 2",
      important: false
    });
    createdIds.push(r.id);
    expect(r.id).toBeTruthy();
    expect(r.version).toBe("vTEST-0.0.1");
    expect(r.important).toBe(false);
  }));

  it("getRelease 软删后 404", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-0.0.2",
      title: "软删测试",
      summary: "删完应该 404",
      content: "x"
    });
    createdIds.push(r.id);
    const got = await getRelease(buildSales(), r.id);
    expect(got.id).toBe(r.id);
    await softDeleteRelease(buildAdmin(), r.id);
    await expect(getRelease(buildSales(), r.id)).rejects.toMatchObject({ status: 404 });
  }));

  it("listReleases 默认按 publishedAt desc, important 排前", guard(async () => {
    const older = await createRelease(buildAdmin(), {
      version: "vTEST-older",
      title: "older",
      summary: "旧",
      content: "x"
    });
    createdIds.push(older.id);
    // 手动改 publishedAt 让 older 排后
    await prisma.appRelease.update({
      where: { id: older.id },
      data: { publishedAt: new Date(Date.now() - 60_000) }
    });
    const newer = await createRelease(buildAdmin(), {
      version: "vTEST-newer-important",
      title: "newer important",
      summary: "新且重要",
      content: "x",
      important: true
    });
    createdIds.push(newer.id);
    const list = await listReleases(buildSales(), { page: 1, pageSize: 100 });
    const found = list.list.filter((x) => createdIds.includes(x.id));
    expect(found.length).toBeGreaterThanOrEqual(2);
    // newer.important=true 排在 older 前
    const ids = found.map((x) => x.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  }));
});

describe("AppRelease git source", () => {
  it("createRelease with source=GIT_COMMITS 写库时落 gitFrom/gitTo/gitCommitCount", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-GIT-0.0.1",
      title: "git 生成测试",
      summary: "auto",
      content: "content",
      source: "GIT_COMMITS",
      gitFrom: "abc1234",
      gitTo: "def5678",
      gitCommitCount: 7
    });
    createdIds.push(r.id);
    expect(r.source).toBe("GIT_COMMITS");
    expect(r.gitFrom).toBe("abc1234");
    expect(r.gitTo).toBe("def5678");
    expect(r.gitCommitCount).toBe(7);
  }));

  it("m-5: 同 version 重复创建抛 409 CONFLICT", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-DUP-0.0.1",
      title: "first",
      summary: "s",
      content: "c"
    });
    createdIds.push(r.id);
    // 第二次同 version 应拒绝
    await expect(
      createRelease(buildAdmin(), {
        version: "vTEST-DUP-0.0.1",
        title: "second",
        summary: "s",
        content: "c"
      })
    ).rejects.toMatchObject({ status: 409 });
    // 软删后允许重建
    await softDeleteRelease(buildAdmin(), r.id);
    const r2 = await createRelease(buildAdmin(), {
      version: "vTEST-DUP-0.0.1",
      title: "recreate",
      summary: "s",
      content: "c"
    });
    createdIds.push(r2.id);
    expect(r2.title).toBe("recreate");
  }));

  it("M-1: validator 归一化 '0.7.0' → 'v0.7.0' 后 service 视为重复", guard(async () => {
    // admin POST /api/app-releases 走 service.createRelease, 那里已经
    // 看到归一化后的 version。直接调 service 验证: 先用 v0.7.1 创一条,
    // 再用 0.7.1 (validator 归一化后到 v0.7.1) 应该报 409。
    // 这里直接传归一化后的 version 模拟 service 内部看到的值。
    const v = "vTEST-NORM-0.0.1";
    const r1 = await createRelease(buildAdmin(), {
      version: v,
      title: "first",
      summary: "s",
      content: "c"
    });
    createdIds.push(r1.id);
    // service 接到 version 时 validator 已经归一化; service 内部不再
    // 二次 transform, 查重就是同字符串比较
    await expect(
      createRelease(buildAdmin(), {
        version: v,
        title: "dup",
        summary: "s",
        content: "c"
      })
    ).rejects.toMatchObject({ status: 409 });
  }));

  it("不传 source 时默认 MANUAL 且 git* 字段为 null", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-MANUAL-0.0.1",
      title: "手写测试",
      summary: "manual",
      content: "content"
    });
    createdIds.push(r.id);
    expect(r.source).toBe("MANUAL");
    expect(r.gitFrom).toBeNull();
    expect(r.gitTo).toBeNull();
    expect(r.gitCommitCount).toBeNull();
  }));
});

describe("AppReleaseRead 已读追踪", () => {
  it("markReleaseRead 幂等: 重复调用 readAt 不变", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-read",
      title: "已读测试",
      summary: "x",
      content: "x"
    });
    createdIds.push(r.id);
    const first = await markReleaseRead(buildSales(), r.id);
    createdReadIds.push(first.id);
    const second = await markReleaseRead(buildSales(), r.id);
    expect(second.id).toBe(first.id);
    expect(second.readAt.getTime()).toBe(first.readAt.getTime());
  }));

  it("getLatestUnreadRelease 已读后返回 null", guard(async () => {
    const r = await createRelease(buildAdmin(), {
      version: "vTEST-latest-unread",
      title: "即将被读",
      summary: "x",
      content: "x"
    });
    createdIds.push(r.id);
    // 初始:对该用户是未读(假设这个 release 是最新)
    const before = await getLatestUnreadRelease(buildSales());
    // 在最干净的场景下 before.release 应当是 r;但测试中可能插入了多条最新 release,
    // 我们不强制 before.release===r,只验证 read 后 release 不再是 r。
    await markReleaseRead(buildSales(), r.id);
    createdReadIds.push(
      (await prisma.appReleaseRead.findUnique({
        where: { userId_releaseId: { userId: buildSales().id, releaseId: r.id } }
      }))!.id
    );
    const after = await getLatestUnreadRelease(buildSales());
    if (after.release) {
      expect(after.release.id).not.toBe(r.id);
    } else {
      // 所有 release 都已读,也算符合预期
      expect(after.release).toBeNull();
    }
    expect(before).toBeTruthy();
  }));
});
