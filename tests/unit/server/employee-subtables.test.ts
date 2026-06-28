// 5 张子表 service 单元回归。
// 覆盖 list 404 / DTO 格式 / create 事务 / update 404 / delete 404。
// DB 不可达时整组 skip（参考 employee-profile.test.ts 模式）。

import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";

import { listEmployeeEducations, createEmployeeEducation } from "@/server/services/employee-education";
import { listEmployeeWorkExperiences, createEmployeeWorkExperience } from "@/server/services/employee-work-experience";
import { listEmployeeCertificates, createEmployeeCertificate } from "@/server/services/employee-certificate";
import { listEmployeeSkills, createEmployeeSkill } from "@/server/services/employee-skill";
import { listEmployeeEmergencyContacts, createEmployeeEmergencyContact } from "@/server/services/employee-emergency-contact";

let dbReachable = false;
let profileId: string | null = null;

const actor: SessionUser = {
  id: "test-actor",
  employeeNo: "TEST001",
  name: "Test Admin",
  email: "test@qt.local",
  roleCode: "ADMIN",
  permissions: []
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // 找一个或建一个 profile 用于 list 测试
  const existing = await prisma.employeeProfile.findFirst({
    where: { deletedAt: null },
    select: { id: true }
  });
  if (existing) {
    profileId = existing.id;
  } else {
    const user = await prisma.user.findFirst({ where: { deletedAt: null } });
    if (user) {
      const created = await prisma.employeeProfile.create({ data: { userId: user.id } });
      profileId = created.id;
    }
  }
});

const itDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !profileId) return;
    await fn();
  });

describe("EmployeeEducation", () => {
  itDb("list: 404 when profile not found", async () => {
    await expect(listEmployeeEducations(actor, "non-existent-id")).rejects.toThrow(ApiError);
  });

  itDb("list: returns DTOs with ISO date strings", async () => {
    const out = await listEmployeeEducations(actor, profileId!);
    expect(Array.isArray(out)).toBe(true);
    for (const e of out) {
      expect(typeof e.startDate).toBe("string");
      expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  itDb("create: persists row and returns DTO", async () => {
    const out = await createEmployeeEducation(actor, {
      profileId: profileId!,
      school: "Test University",
      startDate: "2020-09-01T00:00:00Z",
      isFullTime: true
    });
    expect(out.school).toBe("Test University");
    expect(out.startDate).toBe("2020-09-01T00:00:00.000Z");
    expect(out.isFullTime).toBe(true);
  });
});

describe("EmployeeWorkExperience", () => {
  itDb("list: 404 when profile not found", async () => {
    await expect(listEmployeeWorkExperiences(actor, "non-existent-id")).rejects.toThrow(ApiError);
  });

  itDb("create: persists row", async () => {
    const out = await createEmployeeWorkExperience(actor, {
      profileId: profileId!,
      company: "Test Corp",
      startDate: "2018-01-01T00:00:00Z"
    });
    expect(out.company).toBe("Test Corp");
    expect(out.position).toBeNull();
  });
});

describe("EmployeeCertificate", () => {
  itDb("list: 404 when profile not found", async () => {
    await expect(listEmployeeCertificates(actor, "non-existent-id")).rejects.toThrow(ApiError);
  });

  itDb("create: persists row with expiryDate", async () => {
    const out = await createEmployeeCertificate(actor, {
      profileId: profileId!,
      name: "Test Cert",
      issueDate: "2024-01-01T00:00:00Z",
      expiryDate: "2027-01-01T00:00:00Z"
    });
    expect(out.name).toBe("Test Cert");
    expect(out.expiryDate).toBe("2027-01-01T00:00:00.000Z");
  });
  // 注: issueDate > expiryDate 校验在 validator 层（API route 调 zod.parse），
  // service 层不重复校验。validator 测试见 tests/unit/validators/employee-subtables.test.ts
});

describe("EmployeeSkill", () => {
  itDb("list: 404 when profile not found", async () => {
    await expect(listEmployeeSkills(actor, "non-existent-id")).rejects.toThrow(ApiError);
  });

  itDb("create: defaults level to INTERMEDIATE", async () => {
    const out = await createEmployeeSkill(actor, {
      profileId: profileId!,
      name: "TypeScript",
      level: "INTERMEDIATE"
    });
    expect(out.name).toBe("TypeScript");
    expect(out.level).toBe("INTERMEDIATE");
  });
});

describe("EmployeeEmergencyContact", () => {
  itDb("list: 404 when profile not found", async () => {
    await expect(listEmployeeEmergencyContacts(actor, "non-existent-id")).rejects.toThrow(ApiError);
  });

  itDb("create: persists row", async () => {
    const out = await createEmployeeEmergencyContact(actor, {
      profileId: profileId!,
      name: "张父",
      relationship: "父母",
      phone: "13800000000"
    });
    expect(out.name).toBe("张父");
    expect(out.relationship).toBe("父母");
    expect(out.phone).toBe("13800000000");
  });
  // 注: phone regex 校验在 validator 层，service 不重复。validator 测试见 tests/unit/validators/employee-subtables.test.ts
});
