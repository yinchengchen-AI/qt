// 客户域"读放开 / 写守门"回归 (role-browse-permissions todo 3)
//
// 新口径: SALES / EXPERT 可浏览全公司客户 (list / get / 360 overview / 关联合同列表),
// 但写仍限本人名下 — 越权 PATCH 由 assertRecordWritable 抛 403 FORBIDDEN (无权操作他人客户),
// 负责人转移仍仅 ADMIN。越权写不再返回 404。
//
// DB 不可达时整组 skip。数据带唯一 TAG 前缀, 跑完自清理。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomer,
  getCustomerOverview,
  listCustomerContracts,
} from "@/server/services/customer";

let dbReachable = false;
const TAG = `TEST-CUST-BROWSE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type UserRow = { id: string; employeeNo: string; name: string; email: string | null };
let adminRow: UserRow | null = null;
let actorRow: UserRow | null = null; // 真实存在的用户, 仅借 id 构造 SALES/EXPERT session
const createdCustomerIds: string[] = [];
let otherCustomerId: string | null = null; // owner = adminRow (对 actor 来说是他人)
let ownCustomerId: string | null = null; // owner = actorRow

function mkSession(row: UserRow, roleCode: SessionUser["roleCode"]): SessionUser {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    name: row.name,
    email: row.email ?? `${row.employeeNo}@t.local`,
    roleCode,
    permissions: [],
  };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true },
  });
  // 借一个非 admin 的真实用户 id 当"普通员工" (其 DB 角色不影响 service 层用 session.roleCode 判定)
  actorRow = await prisma.user.findFirst({
    where: { deletedAt: null, id: { not: adminRow?.id ?? "" } },
    select: { id: true, employeeNo: true, name: true, email: true },
  });
  if (!adminRow || !actorRow) return;
  const admin = mkSession(adminRow, "ADMIN");
  const other = await createCustomer(admin, {
    name: `${TAG}-他人客户`,
    customerType: "ENTERPRISE",
    province: "浙江省",
    city: "杭州市",
    contactPhone: "13800000000",
  });
  createdCustomerIds.push(other.id);
  otherCustomerId = other.id;
  const own = await createCustomer(admin, {
    name: `${TAG}-自己客户`,
    customerType: "ENTERPRISE",
    province: "浙江省",
    city: "杭州市",
    contactPhone: "13900000000",
    ownerUserId: actorRow.id,
  });
  createdCustomerIds.push(own.id);
  ownCustomerId = own.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const ready = () => dbReachable && adminRow && actorRow && otherCustomerId && ownCustomerId;

async function captureErr(fn: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as ApiError;
  }
}

describe("客户域读放开 (SALES/EXPERT 可见他人客户)", () => {
  it("SALES 列表可见他人名下客户 (200 且含他人记录)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const { list } = await listCustomers(sales, { page: 1, pageSize: 50, keyword: TAG });
    const ids = list.map((c) => c.id);
    expect(ids).toContain(otherCustomerId);
    expect(ids).toContain(ownCustomerId);
  });

  it("SALES get 他人客户详情 → 200 返回数据", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const c = await getCustomer(sales, otherCustomerId!);
    expect(c.id).toBe(otherCustomerId);
    expect(c.name).toBe(`${TAG}-他人客户`);
  });

  it("EXPERT get 他人客户详情 → 200 返回数据", async () => {
    if (!ready()) return;
    const expert = mkSession(actorRow!, "EXPERT");
    const c = await getCustomer(expert, otherCustomerId!);
    expect(c.id).toBe(otherCustomerId);
  });

  it("SALES 360 概览他人客户 → 200 (不再 404)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const overview = await getCustomerOverview(sales, otherCustomerId!);
    expect(overview.totals.contractCount).toBe(0);
    expect(overview.contracts).toEqual([]);
  });

  it("SALES 关联合同列表对他人客户 → 200 (不再 throw)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const contracts = await listCustomerContracts(sales, otherCustomerId!);
    expect(contracts).toEqual([]);
  });
});

describe("客户域写守门 (越权写 403, 不再 404)", () => {
  it("SALES PATCH 他人客户 → 403 FORBIDDEN (无权操作他人客户)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const e = await captureErr(() =>
      updateCustomer(sales, otherCustomerId!, { name: `${TAG}-越权改名` })
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(e!.status).toBe(403);
    expect(e!.message).toContain("无权操作他人客户");
  });

  it("EXPERT PATCH 他人客户 → 403 FORBIDDEN (无权操作他人客户)", async () => {
    if (!ready()) return;
    const expert = mkSession(actorRow!, "EXPERT");
    const e = await captureErr(() =>
      updateCustomer(expert, otherCustomerId!, { name: `${TAG}-越权改名` })
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(e!.status).toBe(403);
    expect(e!.message).toContain("无权操作他人客户");
  });

  it("SALES PATCH 自己名下客户 → 200", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const updated = await updateCustomer(sales, ownCustomerId!, { name: `${TAG}-自己改名` });
    expect(updated.name).toBe(`${TAG}-自己改名`);
  });

  it("非 ADMIN 转移 ownerUserId → 仍 403 (仅管理员可转移客户负责人)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const e = await captureErr(() =>
      updateCustomer(sales, ownCustomerId!, { ownerUserId: adminRow!.id })
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(e!.status).toBe(403);
    expect(e!.message).toContain("仅管理员可转移客户负责人");
  });

  it("PATCH 不存在的客户 id → 404 NOT_FOUND (不是 500)", async () => {
    if (!ready()) return;
    const sales = mkSession(actorRow!, "SALES");
    const e = await captureErr(() =>
      updateCustomer(sales, "cust-nonexistent-id-000", { name: `${TAG}-x` })
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(e!.status).toBe(404);
  });
});
