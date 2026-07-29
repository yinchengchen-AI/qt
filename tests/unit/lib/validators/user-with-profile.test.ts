// userWithProfileUpdateSchema 回归:
//   1) 紧急联系人电话:手机号 / 座机(带或不带分隔符)通过,非法拒绝
//   2) profile 字段为 null 一律拒绝 —— 前端 normalizeValues 必须剔除 null
//      (服务端 null 初值、直辖市两级级联 district:null 都会带到表单 store)
//   3) "每步独立保存"的 payload 形状(仅子表 + expectedUpdatedAt)合法

import { describe, it, expect } from "vitest";
import { userWithProfileUpdateSchema } from "@/lib/validators/user";

const contact = (phone: string) => ({
  emergencyContacts: [{ name: "张三", relationship: "父母", phone }]
});

describe("userWithProfileUpdateSchema", () => {
  it("手机号通过", () => {
    expect(userWithProfileUpdateSchema.safeParse(contact("13800000000")).success).toBe(true);
  });

  it("座机(带/不带分隔符)通过", () => {
    expect(userWithProfileUpdateSchema.safeParse(contact("010-12345678")).success).toBe(true);
    expect(userWithProfileUpdateSchema.safeParse(contact("057112345678")).success).toBe(true);
  });

  it("非法电话拒绝", () => {
    expect(userWithProfileUpdateSchema.safeParse(contact("12345")).success).toBe(false);
  });

  it("profile 字段为 null 拒绝(前端须先剔除 null)", () => {
    expect(userWithProfileUpdateSchema.safeParse({ profile: { district: null } }).success).toBe(false);
    expect(userWithProfileUpdateSchema.safeParse({ profile: { birthday: null } }).success).toBe(false);
  });

  it("仅子表 + expectedUpdatedAt(每步独立保存的 payload 形状)通过", () => {
    const res = userWithProfileUpdateSchema.safeParse({
      expectedUpdatedAt: "2026-07-29T00:00:00.000Z",
      skills: [{ name: "Photoshop", level: "BEGINNER" }]
    });
    expect(res.success).toBe(true);
  });

  it("空 payload 通过(全部可选)", () => {
    expect(userWithProfileUpdateSchema.safeParse({}).success).toBe(true);
  });
});
