// 跟进 360 (getFollowUpOverview) 的行级隔离回归测试
// 锁住 #1 修复:
//   旧实现: `canSeeAll = hasPermission(role, CUSTOMER, EXPORT)`
//     → SALES/EXPERT 都有 CUSTOMER.EXPORT, 错误地拿到"看全部"语义, 越过行级隔离
//   新实现: `canSeeAll = canSeeAllFollowUps(role)`, 显式列出 ADMIN/FINANCE/OPS
//
// 这个测试不依赖 DB:只测纯函数 canSeeAllFollowUps 和"不能复用 EXPORT 代理"的契约。
import { describe, it, expect } from "vitest";
import { canSeeAllFollowUps } from "../server/services/customer";
import { RESOURCE, ACTION, hasPermission } from "../lib/permissions";

describe("FollowUp 360 行级隔离(canSeeAllFollowUps)", () => {
  it("ADMIN / FINANCE / OPS 看全部", () => {
    expect(canSeeAllFollowUps("ADMIN")).toBe(true);
    expect(canSeeAllFollowUps("FINANCE")).toBe(true);
    expect(canSeeAllFollowUps("OPS")).toBe(true);
  });

  it("SALES / EXPERT 只看自己(owner)", () => {
    expect(canSeeAllFollowUps("SALES")).toBe(false);
    expect(canSeeAllFollowUps("EXPERT")).toBe(false);
  });

  it("CUSTOMER.EXPORT 不能作为'看全部'代理: SALES/EXPERT 有 EXPORT 但仍只能看自己", () => {
    // 锁住反例: 旧实现用 `hasPermission(role, CUSTOMER, EXPORT)` 判定 canSeeAll,
    // 会让 SALES/EXPERT 看到全公司客户跟进——这条断言保证这种误用被任何后续
    // 复盘 fix 的人立刻识别出来。
    expect(hasPermission("SALES", RESOURCE.CUSTOMER, ACTION.EXPORT)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.CUSTOMER, ACTION.EXPORT)).toBe(true);
    expect(canSeeAllFollowUps("SALES")).toBe(false);
    expect(canSeeAllFollowUps("EXPERT")).toBe(false);
  });
});
