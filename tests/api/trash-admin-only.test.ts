// 回收站 (trash) — service 层 ADMIN-only 守护回归测试
//
// 覆盖:
//   - 非 ADMIN 调用 getTrashList / restoreRecord 应立即 403 (service 层硬守门)
//   - ADMIN 可正常通过入口 (里面是否真返回数据取决于 DB 内是否有 deleted 记录, 这里不强制)
//
// 此前 trash 入口只检 CUSTOMER.READ, 服务层无角色守门, 非 admin 可绕过菜单直接命中;
// v0.x.x 之后 getTrashList / restoreRecord 入口加 roleCode === "ADMIN" 强校验.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { getTrashList, restoreRecord } from "@/server/services/trash";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let opsUser: SessionUser | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow, opsRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { code: "OPS" }, deletedAt: null, isSystem: false }, select: { id: true } })
  ]);
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: "x", name: "x", email: "x@x", roleCode: "ADMIN", permissions: [] };
  if (salesRow) salesUser = { id: salesRow.id, employeeNo: "x", name: "x", email: "x@x", roleCode: "SALES", permissions: [] };
  if (opsRow) opsUser = { id: opsRow.id, employeeNo: "x", name: "x", email: "x@x", roleCode: "OPS", permissions: [] };
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !opsUser) return;
  await fn();
};

describe("trash service — admin only 守门", () => {
  it("SALES 调用 getTrashList -> 403", guard(async () => {
    await expect(getTrashList(salesUser!)).rejects.toMatchObject({ status: 403 });
  }));

  it("OPS 调用 getTrashList -> 403", guard(async () => {
    await expect(getTrashList(opsUser!)).rejects.toMatchObject({ status: 403 });
  }));

  it("SALES 调用 restoreRecord (任意实体) -> 403", guard(async () => {
    await expect(restoreRecord(salesUser!, "Customer", "no-such-id")).rejects.toMatchObject({ status: 403 });
  }));

  it("OPS 调用 restoreRecord (任意实体) -> 403", guard(async () => {
    await expect(restoreRecord(opsUser!, "Customer", "no-such-id")).rejects.toMatchObject({ status: 403 });
  }));

  it("ADMIN 调用 getTrashList 不被守门拦截 (返回空数组或记录列表, 由 DB 决定)", guard(async () => {
    const r = await getTrashList(adminUser!);
    expect(Array.isArray(r)).toBe(true);
  }));

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
