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
});
