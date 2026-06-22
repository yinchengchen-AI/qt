// 客户 PATCH API 状态变更校验 (P 客户状态机优化 §Test Plan)
//
// 覆盖:
//   1) customerUpdateSchema: status='INVALID_STATUS' → ZodError (VALIDATION_FAILED)
//   2) customerUpdateSchema: status='LEAD' (合法枚举) → 通过
//   3) customerUpdateSchema: 省略 status → 通过 (status 是 optional)
//   4) customerUpdateSchema: reason 字段最大 200 字符
//   5) assertCanTransition: 当前 SIGNED 时 status='LEAD' → 抛 CUSTOMER_STATUS_TRANSITION_INVALID
//
// 不依赖 DB; 测的是 "PATCH 路由前的两道闸门" (Zod 校验 + 状态机迁移合法性)
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { customerUpdateSchema } from "@/lib/validators/customer";
import { assertCanTransition } from "@/server/services/customer-status";

describe("PATCH /api/customers/:id - status 字段 Zod 校验", () => {
  it("status='INVALID_STATUS' 抛 ZodError (最终映射为 VALIDATION_FAILED)", () => {
    expect(() => customerUpdateSchema.parse({ status: "INVALID_STATUS" })).toThrow(ZodError);
  });

  it("status='LEAD' (合法枚举) 通过", () => {
    const r = customerUpdateSchema.parse({ status: "LEAD" });
    expect(r.status).toBe("LEAD");
  });

  it("省略 status: 通过 (status 是 optional)", () => {
    const r = customerUpdateSchema.parse({ name: "X-Corp" });
    expect(r.status).toBeUndefined();
  });

  it("reason 超过 200 字符抛 ZodError", () => {
    expect(() =>
      customerUpdateSchema.parse({ status: "LOST", reason: "x".repeat(201) })
    ).toThrow(ZodError);
  });

  it("reason 200 字符边界通过", () => {
    const r = customerUpdateSchema.parse({ status: "LOST", reason: "x".repeat(200) });
    expect(r.reason?.length).toBe(200);
  });

  it("reason 缺省时仍然通过 schema (前端可后补, 服务端再校验必填)", () => {
    // 注意: schema 仅校验格式 (max 200); 业务必填 (LOST/FROZEN) 由 service 端按 status 决定
    const r = customerUpdateSchema.parse({ status: "LOST" });
    expect(r.reason).toBeUndefined();
  });
});

describe("PATCH /api/customers/:id - 状态机迁移合法性 (CUSTOMER_STATUS_TRANSITION_INVALID)", () => {
  it("当前 SIGNED → 'LEAD' 抛 CUSTOMER_STATUS_TRANSITION_INVALID", () => {
    try {
      assertCanTransition("SIGNED", "LEAD");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
      expect((e as ApiError).status).toBe(422);
    }
  });

  it("当前 LEAD → 'FROZEN' 抛 CUSTOMER_STATUS_TRANSITION_INVALID", () => {
    try {
      assertCanTransition("LEAD", "FROZEN");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ApiError).errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
    }
  });

  it("当前 NEGOTIATING → 'NEGOTIATING' 抛 (同状态写入也视为非法)", () => {
    expect(() => assertCanTransition("NEGOTIATING", "NEGOTIATING")).toThrowError(ApiError);
  });
});
