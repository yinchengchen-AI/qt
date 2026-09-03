// lib/message-categories.ts 单测
//
// 覆盖:
//   - categoryOf 把 20+ MessageType 正确分组到 6 类
//   - 未知 type 落到 unknown
//   - DEPRECATED 类型 (CUSTOMER_STATUS_*) 落到 unknown
//   - isSubscribable 排除已下线
//   - SUBSCRIBABLE_MESSAGE_TYPES 不含已下线
import { describe, it, expect } from "vitest";
import {
  categoryOf,
  MESSAGE_CATEGORY,
  SUBSCRIBABLE_MESSAGE_TYPES,
  isSubscribable,
  isMessageCategory
} from "@/lib/message-categories";
import { MESSAGE_TYPE } from "@/types/enums";

describe("categoryOf", () => {
  it("合同域类型归类正确", () => {
    expect(categoryOf("CONTRACT_EXPIRING")).toBe(MESSAGE_CATEGORY.CONTRACT);
    expect(categoryOf("CONTRACT_AUTO_EXECUTED")).toBe(MESSAGE_CATEGORY.CONTRACT);
    expect(categoryOf("RISK_LEVEL_UP")).toBe(MESSAGE_CATEGORY.CONTRACT);
    expect(categoryOf("CONTRACT_RENEWAL_REMIND")).toBe(MESSAGE_CATEGORY.CONTRACT);
    expect(categoryOf("LINKAGE_NO_INVOICE")).toBe(MESSAGE_CATEGORY.CONTRACT);
    expect(categoryOf("LINKAGE_INVOICE_PAYMENT_GAP")).toBe(MESSAGE_CATEGORY.CONTRACT);
  });

  it("财务域类型归类正确", () => {
    expect(categoryOf("INVOICE_OVERDUE_PAYMENT")).toBe(MESSAGE_CATEGORY.FINANCE);
    expect(categoryOf("PAYMENT_RECEIVED")).toBe(MESSAGE_CATEGORY.FINANCE);
    expect(categoryOf("INVOICE_ISSUED")).toBe(MESSAGE_CATEGORY.FINANCE);
    expect(categoryOf("INVOICE_REJECTED")).toBe(MESSAGE_CATEGORY.FINANCE);
  });

  it("对账域类型归类正确", () => {
    expect(categoryOf("RECONCILIATION_AUTO_MATCHED")).toBe(MESSAGE_CATEGORY.RECONCILIATION);
    expect(categoryOf("RECONCILIATION_SUGGESTION")).toBe(MESSAGE_CATEGORY.RECONCILIATION);
    expect(categoryOf("RECONCILIATION_DISCREPANCY")).toBe(MESSAGE_CATEGORY.RECONCILIATION);
    expect(categoryOf("RECONCILIATION_WEEKLY_REPORT")).toBe(MESSAGE_CATEGORY.RECONCILIATION);
  });

  it("证书域归类正确", () => {
    expect(categoryOf("CERTIFICATE_EXPIRING")).toBe(MESSAGE_CATEGORY.CERTIFICATE);
  });

  it("已下线类型 (CUSTOMER_STATUS_*) 归到 unknown", () => {
    expect(categoryOf("CUSTOMER_STATUS_SUGGEST")).toBe(MESSAGE_CATEGORY.UNKNOWN);
    expect(categoryOf("CUSTOMER_STATUS_AUTO_APPLIED")).toBe(MESSAGE_CATEGORY.UNKNOWN);
    expect(categoryOf("CUSTOMER_STATUS_AUTO_REVERTED")).toBe(MESSAGE_CATEGORY.UNKNOWN);
  });

  it("未知 type 归到 unknown", () => {
    expect(categoryOf("FUTURE_TYPE")).toBe(MESSAGE_CATEGORY.UNKNOWN);
    expect(categoryOf("")).toBe(MESSAGE_CATEGORY.UNKNOWN);
  });
});

describe("isSubscribable / SUBSCRIBABLE_MESSAGE_TYPES", () => {
  it("排除已下线类型", () => {
    expect(isSubscribable("CONTRACT_EXPIRING")).toBe(true);
    expect(isSubscribable("CUSTOMER_STATUS_SUGGEST")).toBe(false);
    expect(isSubscribable("CUSTOMER_STATUS_AUTO_APPLIED")).toBe(false);
    expect(isSubscribable("CUSTOMER_STATUS_AUTO_REVERTED")).toBe(false);
  });

  it("SUBSCRIBABLE_MESSAGE_TYPES 不含已下线", () => {
    expect(SUBSCRIBABLE_MESSAGE_TYPES).not.toContain("CUSTOMER_STATUS_SUGGEST");
    expect(SUBSCRIBABLE_MESSAGE_TYPES).not.toContain("CUSTOMER_STATUS_AUTO_APPLIED");
    expect(SUBSCRIBABLE_MESSAGE_TYPES).not.toContain("CUSTOMER_STATUS_AUTO_REVERTED");
  });

  it("SUBSCRIBABLE_MESSAGE_TYPES 全部在 MESSAGE_TYPE 内", () => {
    for (const t of SUBSCRIBABLE_MESSAGE_TYPES) {
      expect(MESSAGE_TYPE).toContain(t);
    }
  });
});

describe("isMessageCategory", () => {
  it("合法 category 返回 true", () => {
    expect(isMessageCategory("contract")).toBe(true);
    expect(isMessageCategory("finance")).toBe(true);
    expect(isMessageCategory("reconciliation")).toBe(true);
    expect(isMessageCategory("certificate")).toBe(true);
    expect(isMessageCategory("system")).toBe(true);
    expect(isMessageCategory("unknown")).toBe(true);
  });
  it("非法 category 返回 false", () => {
    expect(isMessageCategory("nope")).toBe(false);
    expect(isMessageCategory("")).toBe(false);
    expect(isMessageCategory(null)).toBe(false);
    expect(isMessageCategory(123)).toBe(false);
  });
});
