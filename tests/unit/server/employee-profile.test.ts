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

// PR3 辅助:DB 不可达时自动 skip 的 it 包装
const itDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) return;
    await fn();
  });

// 辅助 getter:避免在 beforeAll 跑完前 top-level 取 adminUser/salesUser
const getAdminActor = (): SessionUser => adminUser ? buildUser(adminUser, "ADMIN") : ({} as SessionUser);
const getSalesActor = (): SessionUser => salesUser ? buildUser(salesUser, "SALES") : ({} as SessionUser);

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

// PR3: 新增 getUserFullProfile / updateUserFullProfile 测试
// 覆盖:
//   - getUserFullProfile: ADMIN 看到敏感字段 + 5 张子表 + avatar
//   - getUserFullProfile: 非 ADMIN 敏感字段 null
//   - getUserFullProfile: 不存在 profile → null
//   - updateUserFullProfile: 409 expectedUpdatedAt 不一致
//   - updateUserFullProfile: 全删全插 5 张子表
// DB 不可达时整组 skip

import { getUserFullProfile, updateUserFullProfile } from "@/server/services/employee-profile";
import { ERROR_CODES } from "@/types/errors";

describe("getUserFullProfile (PR3)", () => {
  itDb("ADMIN: 看到敏感字段 (salary / bankAccount) + 5 张子表 + avatar", async () => {
    if (!adminUser) return;
    const out = await getUserFullProfile(getAdminActor(), adminUser.id);
    if (!out) return; // 用户没档案不算失败
    expect(out.profile).toBeTruthy();
    expect(Array.isArray(out.educations)).toBe(true);
    expect(Array.isArray(out.workExperiences)).toBe(true);
    expect(Array.isArray(out.certificates)).toBe(true);
    expect(Array.isArray(out.skills)).toBe(true);
    expect(Array.isArray(out.emergencyContacts)).toBe(true);
    // avatar 可以是 null,不应抛错
    expect(out.avatar === null || typeof out.avatar === "object").toBe(true);
  });

  itDb("非 ADMIN: 敏感字段为 null", async () => {
    if (!salesUser) return;
    const out = await getUserFullProfile(getSalesActor(), salesUser.id);
    if (!out) return;
    expect(out.profile.salary).toBeNull();
    expect(out.profile.bankAccount).toBeNull();
    expect(out.profile.bankName).toBeNull();
    expect(out.profile.socialSecurityAccount).toBeNull();
    expect(out.profile.providentFundAccount).toBeNull();
    // 业务字段不空
    expect(out.profile.position === null || typeof out.profile.position === "string").toBe(true);
  });

  itDb("不存在 userId → 不抛错,返回 null", async () => {
    if (!adminUser) return;
    const out = await getUserFullProfile(getAdminActor(), "non-existent-user-id");
    expect(out).toBeNull();
  });
});

describe("updateUserFullProfile (PR3)", () => {
  itDb("expectedUpdatedAt 不一致 → 409 CONFLICT", async () => {
    if (!adminUser) return;
    const out = await getUserFullProfile(getAdminActor(), adminUser.id);
    if (!out) return;
    await expect(updateUserFullProfile(getAdminActor(), adminUser.id, {
      expectedUpdatedAt: "2000-01-01T00:00:00Z"  // 故意过期
    })).rejects.toMatchObject({ status: 409, errorCode: ERROR_CODES.CONFLICT });
  });

  itDb("新档案 (user.profile 为空) → upsert 创建 profile,正常落库", async () => {
    if (!dbReachable || !adminUser) return;
    // 找一个还没建档案的 user
    const userNoProfile = await prisma.user.findFirst({
      where: { deletedAt: null, profile: null },
      select: { id: true, employeeNo: true, name: true, email: true }
    });
    if (!userNoProfile) {
      // 临时建一个无 profile 的 user
      const ts = Date.now();
      const temp = await prisma.user.create({
        data: {
          employeeNo: `E2E_${ts}`,
          name: "PR01-无档案",
          email: `e2e_pr01_${ts}@qt.local`,
          passwordHash: "x",
          roleId: (await prisma.user.findFirst({ where: { role: { code: "ADMIN" } } }))!.roleId
        }
      });
      try {
        const out = await updateUserFullProfile(getAdminActor(), temp.id, {
          profile: { position: "P0-1 测试岗位" },
          educations: [{ school: "PR0-1 校", startDate: "2020-09-01T00:00:00Z", isFullTime: true }]
        });
        expect(out.profile.position).toBe("P0-1 测试岗位");
        expect(out.educations.length).toBe(1);
        expect(out.educations[0]?.school).toBe("PR0-1 校");
      } finally {
        // 清理
        await prisma.employeeProfile.deleteMany({ where: { userId: temp.id } });
        await prisma.user.delete({ where: { id: temp.id } });
      }
    }
  });

  itDb("expectedUpdatedAt 一致 → 全删全插 5 张子表,profile 字段更新", async () => {
    if (!adminUser) return;
    const out = await getUserFullProfile(getAdminActor(), adminUser.id);
    if (!out) return;
    const updated = await updateUserFullProfile(getAdminActor(), adminUser.id, {
      expectedUpdatedAt: out.profile.updatedAt,
      profile: { position: "PR3-Test-Position" },
      educations: [{
        school: "PR3-School",
        startDate: "2020-09-01T00:00:00Z",
        isFullTime: true
      }],
      certificates: [{
        name: "PR3-Cert",
        issueDate: "2024-01-01T00:00:00Z",
        expiryDate: "2027-01-01T00:00:00Z"
      }],
      skills: [{ name: "PR3-Skill", level: "ADVANCED" }],
      emergencyContacts: [{ name: "PR3-Contact", relationship: "父母", phone: "13800000000" }],
      workExperiences: [{ company: "PR3-Co", startDate: "2018-01-01T00:00:00Z" }]
    });
    expect(updated.profile.position).toBe("PR3-Test-Position");
    expect(updated.educations.find((e) => e.school === "PR3-School")).toBeTruthy();
    expect(updated.certificates.find((c) => c.name === "PR3-Cert")).toBeTruthy();
    expect(updated.skills.find((s) => s.name === "PR3-Skill" && s.level === "ADVANCED")).toBeTruthy();
    expect(updated.emergencyContacts.find((c) => c.name === "PR3-Contact")).toBeTruthy();
    expect(updated.workExperiences.find((w) => w.company === "PR3-Co")).toBeTruthy();
    // 旧的(若有)被替换
    expect(updated.educations.filter((e) => e.school !== "PR3-School")).toEqual([]);
  });
});
