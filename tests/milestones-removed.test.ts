// 重要 schema 字段删除回归测试
// 一旦这些字段被错误地重新加回 EmployeeProfile schema,这个测试就会 fail,
// 提醒 reviewer 重新审视迁移影响.
//
// 关联的迁移:prisma/migrations/20260701_employee_profile_restructure/migration.sql
// 关联的 spec:docs/superpowers/specs/2026-06-25-employee-profile-redesign-design.md §2.1

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("EmployeeProfile 重构 schema 回归", () => {
  // EmployeeProfile 必须有的字段 (新结构)
  const requiredFields = [
    "id",
    "userId",
    "avatarAttachmentId",
    "province",
    "city",
    "district",
    "addressDetail",
    "deletedAt"
  ];
  for (const f of requiredFields) {
    it(`EmployeeProfile 含字段: ${f}`, () => {
      expect(f in Prisma.EmployeeProfileScalarFieldEnum).toBe(true);
    });
  }

  // EmployeeProfile 不能再有的字段 (已迁到子表或拆字段)
  const removedFields = [
    "workExperience",     // 迁到 EmployeeWorkExperience
    "educationHistory",   // 迁到 EmployeeEducation
    "certificates",       // 迁到 EmployeeCertificate
    "address",            // 拆成 province/city/district/addressDetail
    "emergencyContactName",  // 迁到 EmployeeEmergencyContact
    "emergencyContactPhone"  // 迁到 EmployeeEmergencyContact
  ];
  for (const f of removedFields) {
    it(`EmployeeProfile 不再含字段: ${f}`, () => {
      expect(f in Prisma.EmployeeProfileScalarFieldEnum).toBe(false);
    });
  }

  // 5 张新子表
  const newSubtables = [
    "EmployeeEducation",
    "EmployeeWorkExperience",
    "EmployeeCertificate",
    "EmployeeSkill",
    "EmployeeEmergencyContact"
  ];
  for (const m of newSubtables) {
    it(`子表存在: ${m}`, () => {
      expect(m in Prisma.ModelName || (Prisma as unknown as Record<string, unknown>)[`${m}ScalarFieldEnum`]).toBeTruthy();
    });
  }

  // Attachment 必须有 category
  it("Attachment 含 category 字段", () => {
    expect("category" in Prisma.AttachmentScalarFieldEnum).toBe(true);
  });

  // MessageType 必须有 CERTIFICATE_EXPIRING
  // Prisma 不把 PG enum 暴露为运行时对象,直接查 pg_enum + pg_type 验证
  it("MessageType enum 含 CERTIFICATE_EXPIRING", async () => {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MessageType'
    `;
    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toContain("CERTIFICATE_EXPIRING");
  });
});
