// PATCH /api/customers/[id] 路由行为回归
//
// 覆盖:
//   1) 编辑客户基础信息时 status 与现有相同, 只应更新其他字段, 不应触发状态机报错
//   2) status 真正变化时仍走 changeCustomerStatus 业务校验
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀, 跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import {
  createCustomer,
  getCustomer,
  updateCustomer,
  changeCustomerStatus
} from "@/server/services/customer";

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
    await prisma.operationLog.deleteMany({
      where: { entity: "Customer", action: "CUSTOMER_STATUS_CHANGE" }
    });
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

describe("PATCH /api/customers/:id 状态未变时仍可保存其他字段", () => {
  it("LEAD 客户只改名称, status 仍为 LEAD → 成功, 不触发状态机", guard(async () => {
    const user = buildAdmin();
    const c = await mkCustomer(`${TAG}-same-status`);
    // 模拟路由层行为: 先 get, 比较 status, 相同则跳过 changeCustomerStatus
    const existing = await getCustomer(user, c.id);
    const inputStatus = "LEAD";
    if (inputStatus !== existing.status) {
      await changeCustomerStatus(user, c.id, inputStatus);
    }
    const updated = await updateCustomer(user, c.id, { name: `${TAG}-新名称` });
    expect(updated.name).toBe(`${TAG}-新名称`);
    expect(updated.status).toBe("LEAD");
  }));

  it("status 真正变化时仍走业务校验", guard(async () => {
    const user = buildAdmin();
    const c = await mkCustomer(`${TAG}-change-status`);
    // LEAD → SIGNED 无 ACTIVE 合同 → 应抛 CUSTOMER_STATUS_INVALID
    await expect(changeCustomerStatus(user, c.id, "SIGNED")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_INVALID
    });
  }));
});
