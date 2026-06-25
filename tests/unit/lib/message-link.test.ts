// lib/message-link.ts 单测
//
// 覆盖:
//   - 常规 kind 翻路径
//   - 防御性归一化:null / id 缺失 / 未知 kind / link 为空对象
//   - 额外字段 (CUSTOMER_STATUS_SUGGEST 的 suggest) 拼回 query string (P3.12)
import { describe, it, expect } from "vitest";
import { buildMessageLinkHref } from "@/lib/message-link";

describe("buildMessageLinkHref", () => {
  it("contract → /contracts/{id}", () => {
    expect(buildMessageLinkHref({ kind: "contract", id: "c-1" })).toBe("/contracts/c-1");
  });

  it("invoice → /invoices/{id}", () => {
    expect(buildMessageLinkHref({ kind: "invoice", id: "i-1" })).toBe("/invoices/i-1");
  });

  it("payment → /payments/{id}", () => {
    expect(buildMessageLinkHref({ kind: "payment", id: "p-1" })).toBe("/payments/p-1");
  });

  it("project → /projects/{id}", () => {
    expect(buildMessageLinkHref({ kind: "project", id: "pr-1" })).toBe("/projects/pr-1");
  });

  it("customer → /customers/{id}", () => {
    expect(buildMessageLinkHref({ kind: "customer", id: "cu-1" })).toBe("/customers/cu-1");
  });

  it("额外字段 suggest=LOST 拼成 query string (CUSTOMER_STATUS_SUGGEST 跳转)", () => {
    const href = buildMessageLinkHref({ kind: "customer", id: "cu-1", suggest: "LOST" });
    expect(href).toBe("/customers/cu-1?suggest=LOST");
  });

  it("suggest=FROZEN 同样能拼回", () => {
    const href = buildMessageLinkHref({ kind: "customer", id: "cu-2", suggest: "FROZEN" });
    expect(href).toBe("/customers/cu-2?suggest=FROZEN");
  });

  it("link 为 null → 返回 null", () => {
    expect(buildMessageLinkHref(null)).toBeNull();
  });

  it("id 缺失 → 返回 null (避免 ${undefined} 坏 URL)", () => {
    expect(buildMessageLinkHref({ kind: "contract" })).toBeNull();
  });

  it("未知 kind → 返回 null", () => {
    expect(buildMessageLinkHref({ kind: "future-thing", id: "x" })).toBeNull();
  });

  it("额外字段值为 null/undefined 会被忽略,只串 stringifyable 的", () => {
    const href = buildMessageLinkHref({
      kind: "customer",
      id: "cu-1",
      suggest: "LOST",
      meta: undefined,
      bogus: { x: 1 } // object 会被跳过
    } as Parameters<typeof buildMessageLinkHref>[0]);
    // object 会被跳过(只 stringify 原始值),undefined 也会被跳过
    expect(href).toBe("/customers/cu-1?suggest=LOST");
  });

  it("数值额外字段也能正确 stringify", () => {
    const href = buildMessageLinkHref({ kind: "customer", id: "cu-1", daysLeft: 7 });
    expect(href).toBe("/customers/cu-1?daysLeft=7");
  });
});
