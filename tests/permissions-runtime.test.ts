// lib/permissions.ts runtime cache 单测 — since v0.18.3
//
// 覆盖:
//   - 默认行为: hasPermission(role, ...) 走 ROLE_PERMISSIONS (code matrix)
//   - setRuntimePermissions(code, perms) 后: hasPermission 走缓存
//   - clearRuntimePermissions(code) 后: 回退到 ROLE_PERMISSIONS
//   - 缓存覆盖原矩阵: ADMIN 删 ROLE.READ 后, hasPermission(ADMIN, ROLE, READ) = false
//   - 缓存可独立于 ROLE_PERMISSIONS 存在 (DB-only 状态, 如新建的自定义角色)
import { describe, it, expect, beforeEach } from "vitest";
import {
  RESOURCE,
  ACTION,
  hasPermission,
  requirePermission,
  setRuntimePermissions,
  clearRuntimePermissions,
  _resetRuntimePermissionsForTests,
  type Permission
} from "../lib/permissions";

beforeEach(() => {
  _resetRuntimePermissionsForTests();
});

describe("默认行为 — 走 ROLE_PERMISSIONS 矩阵", () => {
  it("ADMIN has CRUD on every resource", () => {
    for (const r of Object.values(RESOURCE)) {
      for (const a of [ACTION.READ, ACTION.CREATE, ACTION.UPDATE, ACTION.DELETE]) {
        expect(hasPermission("ADMIN", r, a)).toBe(true);
      }
    }
  });

  it("SALES can update contract but cannot delete", () => {
    expect(hasPermission("SALES", RESOURCE.CONTRACT, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.CONTRACT, ACTION.DELETE)).toBe(false);
  });
});

describe("setRuntimePermissions — DB 真源覆盖 code 矩阵", () => {
  it("覆盖后 hasPermission 走缓存", () => {
    // 假设 admin 把 ADMIN 角色的 CONTRACT 资源删了
    const newAdminPerms: Permission[] = Object.values(RESOURCE)
      .filter((r) => r !== RESOURCE.CONTRACT)
      .map((r) => ({ resource: r, actions: [ACTION.READ, ACTION.CREATE, ACTION.UPDATE, ACTION.DELETE] }));
    setRuntimePermissions("ADMIN", newAdminPerms);

    expect(hasPermission("ADMIN", RESOURCE.USER, ACTION.READ)).toBe(true);
    expect(hasPermission("ADMIN", RESOURCE.CONTRACT, ACTION.READ)).toBe(false);
    expect(hasPermission("ADMIN", RESOURCE.CONTRACT, ACTION.UPDATE)).toBe(false);
  });

  it("clearRuntimePermissions 后回退到 ROLE_PERMISSIONS", () => {
    setRuntimePermissions("ADMIN", []); // 缓存成空
    expect(hasPermission("ADMIN", RESOURCE.USER, ACTION.READ)).toBe(false);
    clearRuntimePermissions("ADMIN");
    expect(hasPermission("ADMIN", RESOURCE.USER, ACTION.READ)).toBe(true);
  });

  it("缓存的角色可以不在 ROLE_PERMISSIONS 联合类型里 (DB-only 状态)", () => {
    // 模拟一个 DB 里的自定义角色 (虽然 createRole 仍 403, 但运行时缓存应支持)
    setRuntimePermissions("CUSTOM_A", [
      { resource: RESOURCE.CONTRACT, actions: [ACTION.READ, ACTION.UPDATE] }
    ]);
    // RoleCode 是 string union, 但 hasPermission 接收 string 也能跑
    expect(hasPermission("CUSTOM_A" as never, RESOURCE.CONTRACT, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("CUSTOM_A" as never, RESOURCE.INVOICE, ACTION.READ)).toBe(false);
  });

  it("requirePermission 抛 ApiError 当权限缺失", () => {
    setRuntimePermissions("ADMIN", []); // ADMIN 啥都没了
    expect(() => requirePermission("ADMIN", RESOURCE.USER, ACTION.READ)).toThrowError(/无权/);
  });

  it("requirePermission 不抛当权限命中", () => {
    setRuntimePermissions("SALES", [
      { resource: RESOURCE.CONTRACT, actions: [ACTION.UPDATE] }
    ]);
    expect(() => requirePermission("SALES", RESOURCE.CONTRACT, ACTION.UPDATE)).not.toThrow();
  });
});
