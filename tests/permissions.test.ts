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

  it("EXPERT 仅查看开票(只读+导出), 不创建/改/删 (商业发起归 SALES)", () => {
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.READ)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.CREATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.DELETE)).toBe(false);
    // 导出仍保留: 让 EXPERT 在交付完成时可拉对账视图
    expect(hasPermission("EXPERT", RESOURCE.INVOICE, ACTION.EXPORT)).toBe(true);
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

  it("DUNNING: SALES/EXPERT 可记录+查看, 不能修改+删除; FINANCE/ADMIN 拿全 CRUD; OPS 只读", () => {
    // 业务现场 (SALES/EXPERT): 仅 CREATE+READ
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.CREATE)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.DELETE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.CREATE)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.DELETE)).toBe(false);
    // 财务对账留痕: 全 CRUD
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.CREATE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.DELETE)).toBe(true);
    // 行政只读 (不参与催收)
    expect(hasPermission("OPS", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("OPS", RESOURCE.DUNNING, ACTION.CREATE)).toBe(false);
  });

  it("ROLE_PERMISSIONS covers all 5 built-in roles", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(["ADMIN", "EXPERT", "FINANCE", "OPS", "SALES"]);
  });
});
