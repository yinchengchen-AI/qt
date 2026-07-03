import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS, RESOURCE, ACTION, hasPermission } from "../lib/permissions";

describe("Role permissions", () => {
  it("ADMIN has CRUD on every resource", () => {
    for (const r of Object.values(RESOURCE)) {
      for (const a of [ACTION.READ, ACTION.CREATE, ACTION.UPDATE, ACTION.DELETE]) {
        expect(hasPermission("ADMIN", r, a)).toBe(true);
      }
    }
  });

  it("SALES can CRUD Customer/Contract and update Invoice draft, but not delete", () => {
    expect(hasPermission("SALES", RESOURCE.CUSTOMER, ACTION.CREATE)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.CONTRACT, ACTION.UPDATE)).toBe(true);
    // 开票管理开放编辑后: 业务可改 DRAFT, 但不能删除
    expect(hasPermission("SALES", RESOURCE.INVOICE, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.INVOICE, ACTION.DELETE)).toBe(false);
    expect(hasPermission("SALES", RESOURCE.STATISTICS, ACTION.EXPORT)).toBe(false);
  });

  it("EXPERT 同样可以编辑 DRAFT 开票", () => {
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.DELETE)).toBe(false);
  });

  it("OPS 不能创建/编辑开票, 只能读", () => {
    expect(hasPermission("OPS", RESOURCE.INVOICE, ACTION.READ)).toBe(true);
    expect(hasPermission("OPS", RESOURCE.INVOICE, ACTION.CREATE)).toBe(false);
    expect(hasPermission("OPS", RESOURCE.INVOICE, ACTION.UPDATE)).toBe(false);
  });

  it("FINANCE has full CRUD on Invoice/Payment and EXPORT statistics", () => {
    expect(hasPermission("FINANCE", RESOURCE.INVOICE, ACTION.DELETE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.PAYMENT, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.STATISTICS, ACTION.EXPORT)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.CUSTOMER, ACTION.CREATE)).toBe(false);
  });

  it("OPS can CRUD Announcement", () => {
    expect(hasPermission("OPS", RESOURCE.ANNOUNCEMENT, ACTION.CREATE)).toBe(true);
  });

  it("ROLE_PERMISSIONS covers all 5 built-in roles", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(["ADMIN", "EXPERT", "FINANCE", "OPS", "SALES"]);
  });
});
