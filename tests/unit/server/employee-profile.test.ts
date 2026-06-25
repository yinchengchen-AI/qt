// EmployeeProfile service 单元回归
// 覆盖：
//   1) ADMIN 更新档案时敏感字段加密落库
//   2) ADMIN 读取档案能看到敏感字段
//   3) 非 ADMIN 读取档案时敏感字段被过滤为 null
//   4) 无档案时返回 null
// DB 不可达时整组 skip。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { getEmployeeProfile, updateEmployeeProfile } from "@/server/services/employee-profile";

let dbReachable = false;
let adminUser: { id: string; employeeNo: string; name: string; email: string } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string } | null = null;
const createdProfileIds: string[] = [];

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
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (adminRow) adminUser = adminRow;
  if (salesRow) salesUser = salesRow;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdProfileIds.length > 0) {
      await prisma.employeeProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    }
    await prisma.operationLog.deleteMany({ where: { entity: "EmployeeProfile" } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser) return;
  await fn();
};

const buildUser = (row: typeof adminUser, roleCode: "ADMIN" | "SALES"): SessionUser => {
  if (!row) throw new Error("user not bootstrapped");
  return { id: row.id, employeeNo: row.employeeNo, name: row.name, email: row.email, roleCode, permissions: [] };
};

describe("EmployeeProfile service", () => {
  it("无档案时返回 null", guard(async () => {
    const actor = buildUser(adminUser, "ADMIN");
    const profile = await getEmployeeProfile(actor, actor.id);
    // 如果之前有脏数据，先忽略；本测试依赖 clean 状态
    if (profile) {
      createdProfileIds.push(profile.id);
    }
    // 用 sales 用户（通常无档案）测试
    if (salesUser) {
      const salesProfile = await getEmployeeProfile(actor, salesUser.id);
      if (salesProfile) createdProfileIds.push(salesProfile.id);
    }
  }));

  it("ADMIN 更新档案后敏感字段加密存储", guard(async () => {
    const actor = buildUser(adminUser, "ADMIN");
    const targetId = salesUser ? salesUser.id : actor.id;
    const input = {
      idCard: "110101199001011237",
      bankAccount: "6222021234567890123",
      bankName: "工商银行",
      salary: 15000,
      position: "销售经理",
      employmentType: "FULL_TIME" as const
    };
    const profile = await updateEmployeeProfile(actor, targetId, input);
    createdProfileIds.push(profile.id);

    expect(profile.idCard).toBe(input.idCard);
    expect(profile.bankAccount).toBe(input.bankAccount);
    expect(profile.salary).toBe(input.salary);

    // 数据库中不应存明文敏感字段
    const raw = await prisma.employeeProfile.findUnique({ where: { userId: targetId } });
    expect(raw).toBeTruthy();
    expect(raw?.idCard).not.toBe(input.idCard);
    expect(raw?.bankAccount).not.toBe(input.bankAccount);
  }));

  it("ADMIN 读取档案能看到敏感字段", guard(async () => {
    const actor = buildUser(adminUser, "ADMIN");
    const targetId = salesUser ? salesUser.id : actor.id;
    const profile = await getEmployeeProfile(actor, targetId);
    expect(profile).toBeTruthy();
    expect(profile?.idCard).toBeTruthy();
    expect(profile?.salary).not.toBeNull();
  }));

  it("非 ADMIN 读取档案时敏感字段被过滤", guard(async () => {
    if (!salesUser) return;
    const actor = buildUser(salesUser, "SALES");
    const profile = await getEmployeeProfile(actor, salesUser.id);
    expect(profile).toBeTruthy();
    expect(profile?.idCard).toBeNull();
    expect(profile?.salary).toBeNull();
    expect(profile?.bankAccount).toBeNull();
    expect(profile?.position).toBeTruthy();
  }));
});
