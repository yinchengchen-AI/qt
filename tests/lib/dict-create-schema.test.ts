import { describe, it, expect } from "vitest";
import { z } from "zod";

const dictCategoryEnum = z.enum([
  "CUSTOMER_TYPE","CUSTOMER_SCALE","CUSTOMER_INDUSTRY","CUSTOMER_SOURCE",
  "SERVICE_TYPE","CONTRACT_PAYMENT_METHOD","PROJECT_STATUS","INVOICE_TYPE",
  "PAYMENT_RECEIVE_METHOD","CUSTOMER_STATUS","CONTRACT_STATUS","INVOICE_STATUS",
  "PAYMENT_STATUS","FOLLOW_METHOD","FOLLOW_RESULT","REVIEW_ACTION"
]);

const dictCreateSchema = z.object({
  category: dictCategoryEnum,
  code: z.string().min(1).max(40).regex(/^[A-Z][A-Z0-9_.]*$/),
  label: z.string().min(1).max(80),
  parentCode: z.string().min(1).max(40).nullable().optional(),
  sort: z.number().int().min(0).max(9999).default(0)
});

describe("dictCreateSchema - parentCode 字段", () => {
  it("顶级 (parentCode 未传) 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE", label: "测试顶级", sort: 1 });
    expect(v.parentCode).toBeUndefined();
  });

  it("顶级 (parentCode=null) 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE", label: "顶级", parentCode: null, sort: 1 });
    expect(v.parentCode).toBeNull();
  });

  it("子级 (parentCode='NEW_TYPE') 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE_CHILD", label: "测试子级", parentCode: "NEW_TYPE", sort: 1 });
    expect(v.parentCode).toBe("NEW_TYPE");
  });

  it("parentCode 长度超过 40 被拒", () => {
    expect(() => dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE", label: "x", parentCode: "A".repeat(41)
    })).toThrow();
  });

  it("空 parentCode 字符串被拒 (min 1)", () => {
    expect(() => dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE", label: "x", parentCode: ""
    })).toThrow();
  });

  it("支持带点的 code (NEW_TYPE.30) 树形编码", () => {
    const v = dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE.30", label: "新街道", parentCode: "NEW_TYPE", sort: 30
    });
    expect(v.code).toBe("NEW_TYPE.30");
    expect(v.parentCode).toBe("NEW_TYPE");
  });

  it("category 不在白名单被拒", () => {
    expect(() => dictCreateSchema.parse({ category: "FAKE_CATEGORY", code: "X", label: "x" })).toThrow();
  });

  it("code 必须大写字母开头", () => {
    expect(() => dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "lowercase", label: "x" })).toThrow();
  });
});
