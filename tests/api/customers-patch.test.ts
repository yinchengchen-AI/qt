// PATCH /api/customers/[id] 路由行为回归 (v0.5.0 客户 status 字段下线后)
//
// 覆盖: 客户 status 字段已下线, PATCH 仅更新非 status 字段 (name 等) 应正常成功
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀, 跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { createCustomer, updateCustomer } from "@/server/services/customer";

let dbReachable = false;
const TAG = `TEST-CUST-PATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
const createdCustomerIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
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

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};

async function mkCustomer(name: string) {
  const user = buildAdmin();
  const c = await createCustomer(user, {
    name,
    customerType: "ENTERPRISE",
    province: "浙江省",
    city: "杭州市",
    contactPhone: "13800000000"
  });
  createdCustomerIds.push(c.id);
  return c;
}

describe("PATCH /api/customers/:id (v0.5.0 客户无 status)", () => {
  it("只改名称等非 status 字段, PATCH 成功", guard(async () => {
    const user = buildAdmin();
    const c = await mkCustomer(`${TAG}-no-status`);
    const updated = await updateCustomer(user, c.id, { name: `${TAG}-新名称` });
    expect(updated.name).toBe(`${TAG}-新名称`);
  }));
});
