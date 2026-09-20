// EmployeeProfile 验证器回归

import { describe, it, expect } from "vitest";
import { employeeProfileUpdateSchema } from "@/lib/validators/employee-profile";

describe("employeeProfileUpdateSchema", () => {
  it("合法输入通过", () => {
    const res = employeeProfileUpdateSchema.safeParse({
      gender: "MALE",
      entryDate: "2024-01-15T00:00:00.000Z",
      salary: 12000.5,
      idCard: "110101199001011237",
      address: "杭州市西湖区"
    });
    expect(res.success).toBe(true);
  });

  it("空对象通过（全部可选）", () => {
    const res = employeeProfileUpdateSchema.safeParse({});
    expect(res.success).toBe(true);
  });

  it("错误身份证号失败", () => {
    const res = employeeProfileUpdateSchema.safeParse({ idCard: "123456" });
    expect(res.success).toBe(false);
  });

  it("空字符串身份证转为 undefined", () => {
    const res = employeeProfileUpdateSchema.safeParse({ idCard: "" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.idCard).toBeUndefined();
    }
  });

  it("负数薪资失败", () => {
    const res = employeeProfileUpdateSchema.safeParse({ salary: -1 });
    expect(res.success).toBe(false);
  });

  it("薪资 null → 显式清空; 空字符串 → undefined(不变)", () => {
    const nullRes = employeeProfileUpdateSchema.safeParse({ salary: null });
    expect(nullRes.success).toBe(true);
    if (nullRes.success) expect(nullRes.data.salary).toBeNull();

    const emptyRes = employeeProfileUpdateSchema.safeParse({ salary: "" });
    expect(emptyRes.success).toBe(true);
    if (emptyRes.success) expect(emptyRes.data.salary).toBeUndefined();
  });

  it("薪资字符串数字可 coerce(老前端兼容)", () => {
    const res = employeeProfileUpdateSchema.safeParse({ salary: "15000" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.salary).toBe(15000);
  });

  it("身份证号 null → 显式清空", () => {
    const res = employeeProfileUpdateSchema.safeParse({ idCard: null });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.idCard).toBeNull();
  });

  it("可空字符串字段(bankAccount 等)接受 null", () => {
    const res = employeeProfileUpdateSchema.safeParse({ bankAccount: null, bankName: null });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.bankAccount).toBeNull();
      expect(res.data.bankName).toBeNull();
    }
  });

  it("非敏感可选字符串字段(district 等)仍拒绝 null(原契约不变)", () => {
    const res = employeeProfileUpdateSchema.safeParse({ district: null });
    expect(res.success).toBe(false);
  });
});
