// 税率枚举校验 (P2-4)
//
// 覆盖:
//   1) invoiceCreateSchema: 标准税率 0/0.01/0.03/0.06/0.09/0.13 通过
//   2) invoiceCreateSchema: 非法税率 0.05/0.07 抛 VALIDATION_FAILED
//   3) contractCreateSchema: 同样规则
//   4) 默认值 0.06 在字段缺省时自动填充
//   5) TAX_RATE_OPTIONS 跟业务档位完全一致
//
// 不依赖 DB, 纯 zod 单测.

import { describe, it, expect } from "vitest";
import { invoiceCreateSchema } from "@/lib/validators/invoice";
import { contractCreateSchema } from "@/lib/validators/contract";
import { TAX_RATE_OPTIONS, TAX_RATE_LABELS, isStandardTaxRate, taxRateSchema } from "@/lib/validators/_shared";

const baseInvoice = {
  contractId: "c-1",
  invoiceNo: "TEST-INV-1",
  invoiceType: "VAT_SPECIAL" as const,
  amount: 100,
  applyDate: "2026-01-01T00:00:00.000Z",
  titleType: "COMPANY" as const,
  titleName: "抬头",
  taxNo: "91330000123456789X",
  attachments: []
};
const baseContract = {
  customerId: "cu-1",
  contractNo: "TEST-C-1",
  title: "测试合同",
  serviceType: "OTHER",
  signDate: "2026-01-01T00:00:00.000Z",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  totalAmount: 1000,
  paymentMethod: "LUMP_SUM" as const,
  attachments: []
};

describe("TAX_RATE_OPTIONS 常量", () => {
  it("覆盖 0 / 1% / 3% / 6% / 9% / 13%", () => {
    expect(TAX_RATE_OPTIONS).toEqual([0, 0.01, 0.03, 0.06, 0.09, 0.13]);
    expect(TAX_RATE_LABELS).toEqual(["0%", "1%", "3%", "6%", "9%", "13%"]);
  });
  it("isStandardTaxRate 区分合法/非法档位", () => {
    for (const v of TAX_RATE_OPTIONS) expect(isStandardTaxRate(v)).toBe(true);
    for (const v of [0.05, 0.07, 0.11, 0.17, 0.99, -0.01]) {
      expect(isStandardTaxRate(v)).toBe(false);
    }
  });
});

describe("invoiceCreateSchema.taxRate (P2-4)", () => {
  it.each(TAX_RATE_OPTIONS)("接受标准税率 %f", (rate) => {
    const res = invoiceCreateSchema.safeParse({ ...baseInvoice, taxRate: rate });
    expect(res.success).toBe(true);
  });
  it.each([0.05, 0.07, 0.11, 0.5, 0.95])("拒绝非法税率 %f", (rate) => {
    const res = invoiceCreateSchema.safeParse({ ...baseInvoice, taxRate: rate });
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = res.error.issues.map((i) => i.message).join("\n");
      expect(msg).toMatch(/税率/);
    }
  });
  it("缺省时回退默认值 0.06", () => {
    const res = invoiceCreateSchema.safeParse({ ...baseInvoice });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.taxRate).toBe(0.06);
  });
});

describe("contractCreateSchema.taxRate (P2-4)", () => {
  it.each(TAX_RATE_OPTIONS)("接受标准税率 %f", (rate) => {
    const res = contractCreateSchema.safeParse({ ...baseContract, taxRate: rate });
    expect(res.success).toBe(true);
  });
  it.each([0.05, 0.08, 0.17, 0.25])("拒绝非法税率 %f", (rate) => {
    const res = contractCreateSchema.safeParse({ ...baseContract, taxRate: rate });
    expect(res.success).toBe(false);
  });
  it("缺省时回退默认值 0.06", () => {
    const res = contractCreateSchema.safeParse({ ...baseContract });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.taxRate).toBe(0.06);
  });
});

describe("taxRateSchema 独立使用", () => {
  it("refine 触发自定义错误信息", () => {
    const r = taxRateSchema.safeParse(0.05);
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue0 = r.error.issues[0];
      expect(issue0).toBeDefined();
      expect(issue0!.message).toMatch(/0% . 1% . 3% . 6% . 9% . 13%/);
    }
  });
});
