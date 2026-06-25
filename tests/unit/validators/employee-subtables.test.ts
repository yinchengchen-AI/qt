// 5 张子表 zod validator 单元测试
import { describe, it, expect } from "vitest";
import { employeeCertificateCreateSchema } from "@/lib/validators/employee-certificate";
import { employeeEmergencyContactCreateSchema } from "@/lib/validators/employee-emergency-contact";
import { employeeEducationCreateSchema } from "@/lib/validators/employee-education";

describe("employeeCertificateCreateSchema", () => {
  const base = { profileId: "p1", name: "Cert" };

  it("accepts when issueDate < expiryDate", () => {
    expect(() => employeeCertificateCreateSchema.parse({
      ...base, issueDate: "2024-01-01T00:00:00Z", expiryDate: "2027-01-01T00:00:00Z"
    })).not.toThrow();
  });

  it("rejects when issueDate > expiryDate", () => {
    expect(() => employeeCertificateCreateSchema.parse({
      ...base, issueDate: "2027-01-01T00:00:00Z", expiryDate: "2024-01-01T00:00:00Z"
    })).toThrow(/颁发日期不能晚于到期日期/);
  });

  it("accepts when only one of issueDate/expiryDate is set", () => {
    expect(() => employeeCertificateCreateSchema.parse({
      ...base, issueDate: "2024-01-01T00:00:00Z"
    })).not.toThrow();
  });
});

describe("employeeEmergencyContactCreateSchema", () => {
  const base = { profileId: "p1", name: "Contact", relationship: "父母" as const };

  it("accepts valid 11-digit phone", () => {
    expect(() => employeeEmergencyContactCreateSchema.parse({ ...base, phone: "13800000000" })).not.toThrow();
  });

  it("rejects bad phone", () => {
    expect(() => employeeEmergencyContactCreateSchema.parse({ ...base, phone: "123" })).toThrow(/手机号格式错误/);
  });

  it("rejects unknown relationship", () => {
    expect(() => employeeEmergencyContactCreateSchema.parse({
      ...base, relationship: "姨夫" as unknown as "父母", phone: "13800000000"
    })).toThrow();
  });
});

describe("employeeEducationCreateSchema", () => {
  it("requires school and startDate", () => {
    expect(() => employeeEducationCreateSchema.parse({ profileId: "p1", startDate: "2020-09-01T00:00:00Z" })).toThrow();
    expect(() => employeeEducationCreateSchema.parse({ profileId: "p1", school: "PKU" })).toThrow();
  });

  it("isFullTime is optional (undefined when not provided)", () => {
    const out = employeeEducationCreateSchema.parse({ profileId: "p1", school: "PKU", startDate: "2020-09-01T00:00:00Z" });
    expect(out.isFullTime).toBeUndefined();
  });

  it("isFullTime accepts explicit true/false", () => {
    const a = employeeEducationCreateSchema.parse({ profileId: "p1", school: "PKU", startDate: "2020-09-01T00:00:00Z", isFullTime: true });
    const b = employeeEducationCreateSchema.parse({ profileId: "p1", school: "PKU", startDate: "2020-09-01T00:00:00Z", isFullTime: false });
    expect(a.isFullTime).toBe(true);
    expect(b.isFullTime).toBe(false);
  });
});
