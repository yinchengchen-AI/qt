import { describe, it, expect } from "vitest";
import { customerCreateSchema, customerUpdateSchema } from "@/lib/validators/customer";

describe("customerUpdateSchema", () => {
  it("保留 status 字段 (回归: 编辑客户改不了状态)", () => {
    // 编辑表单提交时 body 既有其他字段, 也带 status
    const body = {
      name: "测试客户",
      shortName: "测试",
      customerType: "ENTERPRISE",
      province: "北京市",
      city: "北京市",
      contactPhone: "13800000000",
      status: "SIGNED"
    };
    const r = customerUpdateSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("SIGNED");
    }
  });

  it("允许只发 status", () => {
    const r = customerUpdateSchema.safeParse({ status: "NEGOTIATING" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("NEGOTIATING");
    }
  });

  it("允许不发 status", () => {
    const r = customerUpdateSchema.safeParse({ name: "新名字" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBeUndefined();
      expect(r.data.name).toBe("新名字");
    }
  });

  it("拒绝非法 status", () => {
    const r = customerUpdateSchema.safeParse({ status: "BOGUS" });
    expect(r.success).toBe(false);
  });

  it("接受所有合法状态值", () => {
    for (const s of ["LEAD", "NEGOTIATING", "SIGNED", "LOST", "FROZEN"] as const) {
      const r = customerUpdateSchema.safeParse({ status: s });
      expect(r.success, `status=${s} 应通过`).toBe(true);
    }
  });
});

describe("customerCreateSchema", () => {
  it("不包含 status 字段 (创建时由服务固定为 LEAD)", () => {
    // 创建时 status 强制 LEAD, 不应让外部直接传入
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
