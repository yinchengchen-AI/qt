// ASSET.EXPORT 矩阵回归测试
// 锁住矩阵里 #1 修复:
//   旧: ASSET 矩阵所有角色都没有 EXPORT, /api/assets/export 借 listAssets 的 READ 校验
//       蒙混过权限, SALES/OPS/EXPERT 实际能拉资产清单
//   新: ADMIN 拥有 ASSET.EXPORT (随 CRUD); FINANCE 拥有 ASSET.EXPORT (财务月报/审计);
//       SALES/OPS/EXPERT 仍只有 R, 不能导出
import { describe, it, expect } from "vitest";
import { RESOURCE, ACTION, hasPermission } from "../lib/permissions";

describe("ASSET 权限矩阵 (EXPORT 边界)", () => {
  it("ADMIN 拥有 ASSET 全套动作 (CRUD + EXPORT)", () => {
    for (const a of [ACTION.READ, ACTION.CREATE, ACTION.UPDATE, ACTION.DELETE, ACTION.EXPORT]) {
      expect(hasPermission("ADMIN", RESOURCE.ASSET, a)).toBe(true);
    }
  });

  it("FINANCE 拥有 ASSET.EXPORT (月报/审计拉清单需要)", () => {
    expect(hasPermission("FINANCE", RESOURCE.ASSET, ACTION.EXPORT)).toBe(true);
    // 但仍不能改
    expect(hasPermission("FINANCE", RESOURCE.ASSET, ACTION.CREATE)).toBe(false);
    expect(hasPermission("FINANCE", RESOURCE.ASSET, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("FINANCE", RESOURCE.ASSET, ACTION.DELETE)).toBe(false);
  });

  it("SALES / OPS / EXPERT 仅有 ASSET.READ, 不能 EXPORT", () => {
    for (const role of ["SALES", "OPS", "EXPERT"] as const) {
      expect(hasPermission(role, RESOURCE.ASSET, ACTION.READ)).toBe(true);
      expect(hasPermission(role, RESOURCE.ASSET, ACTION.EXPORT)).toBe(false);
      expect(hasPermission(role, RESOURCE.ASSET, ACTION.CREATE)).toBe(false);
      expect(hasPermission(role, RESOURCE.ASSET, ACTION.UPDATE)).toBe(false);
      expect(hasPermission(role, RESOURCE.ASSET, ACTION.DELETE)).toBe(false);
    }
  });
});
