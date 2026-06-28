import { describe, it, expect } from "vitest";
import { customerCreateSchema, customerUpdateSchema } from "@/lib/validators/customer";

describe("customerUpdateSchema", () => {
  it("不包含 status 字段 (v0.5.0 后客户无 status 概念, 编辑表单也不应有 status)", () => {
    const r = customerUpdateSchema.safeParse({
      name: "新名字",
      status: "SIGNED"
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as { status?: string }).status).toBeUndefined();
      expect(r.data.name).toBe("新名字");
    }
  });

  it("允许只发非 status 字段", () => {
    const r = customerUpdateSchema.safeParse({ name: "新名字" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("新名字");
    }
  });
});

describe("customerCreateSchema", () => {
  it("不包含 status 字段 (创建时无 status 概念)", () => {
    const r = customerCreateSchema.safeParse({
      name: "测试",
      customerType: "ENTERPRISE",
      province: "北京",
      city: "北京",
      contactPhone: "13800000000",
      status: "SIGNED"
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as { status?: string }).status).toBeUndefined();
    }
  });
});
