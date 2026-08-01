// role#updateRole 单测 — 覆盖 v0.18.3 的安全护栏 + 缓存失效策略
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionUser } from "@/lib/session";

const mockState = vi.hoisted(() => ({
  roles: new Map<string, {
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: unknown;
    isSystem: boolean;
  }>(),
  users: [] as Array<{ id: string; roleId: string; roleVersion: number; deletedAt: Date | null; isSystem: boolean }>,
  roleVersionUpdates: [] as Array<{ userIds: string[]; delta: number }>,
  cacheInvalidations: [] as string[],
  rolePermCacheInvalidations: [] as string[],
  runtimePermSets: [] as Array<{ code: string; permCount: number }>,
  runtimePermClears: [] as string[],
  audits: [] as Array<Record<string, unknown>>
}));

const ADMIN_FULL_PERMS = vi.hoisted(() => [
  { resource: "ROLE", actions: ["READ", "UPDATE"] },
  { resource: "USER", actions: ["READ"] }
]);
const SALES_PERMS = vi.hoisted(() => [{ resource: "USER", actions: ["READ"] }]);

function seedRoles() {
  mockState.roles.clear();
  mockState.roles.set("r-admin", {
    id: "r-admin",
    code: "ADMIN",
    name: "管理员",
    description: "系统管理员",
    permissions: JSON.parse(JSON.stringify(ADMIN_FULL_PERMS)),
    isSystem: true
  });
  mockState.roles.set("r-sales", {
    id: "r-sales",
    code: "SALES",
    name: "业务人员",
    description: "负责客户/合同",
    permissions: JSON.parse(JSON.stringify(SALES_PERMS)),
    isSystem: true
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: {
      findUnique: vi.fn(async (args: { where: { id?: string; code?: string } }) => {
        if (args.where.id) {
          const r = mockState.roles.get(args.where.id);
          return r ? { ...r, permissions: r.permissions } : null;
        }
        if (args.where.code) {
          for (const r of mockState.roles.values()) {
            if (r.code === args.where.code) return { ...r, permissions: r.permissions };
          }
        }
        return null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = mockState.roles.get(args.where.id);
        if (!r) throw new Error("not found");
        Object.assign(r, args.data);
        return { ...r };
      }),
      count: vi.fn(async () => 0),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        mockState.roles.delete(args.where.id);
        return { id: args.where.id };
      })
    },
    user: {
      findMany: vi.fn(async (args: { where: { roleId: string; deletedAt: null; isSystem: boolean }; select: { id: true } }) => {
        return mockState.users
          .filter((u) => u.roleId === args.where.roleId && u.deletedAt === null && u.isSystem === false)
          .map((u) => ({ id: u.id }));
      }),
      updateMany: vi.fn(async (args: { where: { id: { in: string[] } }; data: { roleVersion: { increment: number } } }) => {
        const ids = new Set(args.where.id.in);
        const affected = mockState.users.filter((u) => ids.has(u.id));
        const delta = args.data.roleVersion.increment;
        mockState.roleVersionUpdates.push({ userIds: [...ids], delta });
        for (const u of affected) u.roleVersion += delta;
        return { count: affected.length };
      }),
      count: vi.fn(async () => 0)
    }
  }
}));

vi.mock("@/lib/auth", () => ({
  invalidateAuthCache: vi.fn((uid: string) => {
    mockState.cacheInvalidations.push(uid);
  }),
  invalidateRolePermCache: vi.fn((code: string) => {
    mockState.rolePermCacheInvalidations.push(code);
  })
}));

vi.mock("@/lib/permissions", () => {
  const ROLE_PERMISSIONS = {
    ADMIN: ADMIN_FULL_PERMS,
    SALES: SALES_PERMS,
    FINANCE: [],
    OPS: [],
    EXPERT: []
  };
  return {
    RESOURCE: { ROLE: "ROLE", USER: "USER", CUSTOMER: "CUSTOMER", CONTRACT: "CONTRACT" },
    ACTION: { READ: "READ", CREATE: "CREATE", UPDATE: "UPDATE", DELETE: "DELETE", EXPORT: "EXPORT" },
    ROLE_PERMISSIONS,
    requirePermission: vi.fn(),
    hasPermission: vi.fn(() => true),
    setRuntimePermissions: vi.fn((code: string, perms: { resource: string; actions: string[] }[]) => {
      mockState.runtimePermSets.push({ code, permCount: perms.length });
    }),
    clearRuntimePermissions: vi.fn((code: string) => {
      mockState.runtimePermClears.push(code);
    })
  };
});

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    mockState.audits.push(input);
  })
}));

import { updateRole, deleteRole } from "@/server/services/role";

const adminUser: SessionUser = {
  id: "u-admin",
  employeeNo: "admin",
  name: "Admin",
  email: "admin@test",
  roleCode: "ADMIN",
  permissions: ADMIN_FULL_PERMS as never
};

beforeEach(() => {
  seedRoles();
  mockState.users = [
    { id: "u-1", roleId: "r-admin", roleVersion: 0, deletedAt: null, isSystem: false },
    { id: "u-2", roleId: "r-sales", roleVersion: 0, deletedAt: null, isSystem: false }
  ];
  mockState.roleVersionUpdates = [];
  mockState.cacheInvalidations = [];
  mockState.rolePermCacheInvalidations = [];
  mockState.runtimePermSets = [];
  mockState.runtimePermClears = [];
  mockState.audits = [];
});

describe("updateRole - 安全护栏", () => {
  it("ADMIN 角色缺少 ROLE.UPDATE → 403 锁死护栏", async () => {
    await expect(
      updateRole(adminUser, "r-admin", {
        permissions: [{ resource: "ROLE", actions: ["READ"] }]
      })
    ).rejects.toThrow(/锁死护栏|读\+改/);
  });

  it("ADMIN 角色缺少 ROLE.READ → 403 锁死护栏", async () => {
    await expect(
      updateRole(adminUser, "r-admin", {
        permissions: [{ resource: "ROLE", actions: ["UPDATE"] }]
      })
    ).rejects.toThrow(/锁死护栏|读\+改/);
  });

  it("ADMIN 角色完全没有 ROLE 资源 → 403", async () => {
    await expect(
      updateRole(adminUser, "r-admin", {
        permissions: [{ resource: "USER", actions: ["READ"] }]
      })
    ).rejects.toThrow(/锁死护栏|读\+改/);
  });

  it("permissions 数组为空 → 400", async () => {
    await expect(
      updateRole(adminUser, "r-sales", { permissions: [] })
    ).rejects.toThrow(/权限不能为空/);
  });

  it("非 ADMIN 角色可任意改 permissions (没强制护栏)", async () => {
    const updated = await updateRole(adminUser, "r-sales", {
      permissions: [{ resource: "CUSTOMER", actions: ["READ", "CREATE"] }]
    });
    expect(updated.permissions).toEqual([{ resource: "CUSTOMER", actions: ["READ", "CREATE"] }]);
  });
});

describe("updateRole - 缓存失效策略", () => {
  it("permissions 改变 → bump 所有该角色 user 的 roleVersion + invalidateAuthCache", async () => {
    await updateRole(adminUser, "r-sales", {
      permissions: [{ resource: "CUSTOMER", actions: ["READ"] }]
    });
    expect(mockState.roleVersionUpdates).toEqual([{ userIds: ["u-2"], delta: 1 }]);
    expect(mockState.cacheInvalidations).toEqual(["u-2"]);
  });

  it("permissions 没变 (等价内容) → 不触发失效", async () => {
    const reordered = [...SALES_PERMS].reverse();
    await updateRole(adminUser, "r-sales", { permissions: reordered });
    expect(mockState.roleVersionUpdates).toEqual([]);
    expect(mockState.cacheInvalidations).toEqual([]);
  });

  it("permissions 改 → setRuntimePermissions 把新权限灌进本进程", async () => {
    await updateRole(adminUser, "r-sales", {
      permissions: [{ resource: "CONTRACT", actions: ["READ"] }]
    });
    expect(mockState.runtimePermSets).toEqual([{ code: "SALES", permCount: 1 }]);
    expect(mockState.rolePermCacheInvalidations).toContain("SALES");
  });

  it("code 改了 → 同时清旧 code 和新 code 的 rolePermCache", async () => {
    await updateRole(adminUser, "r-sales", { code: "OPS" });
    expect(mockState.rolePermCacheInvalidations).toContain("SALES");
    expect(mockState.rolePermCacheInvalidations).toContain("OPS");
    expect(mockState.runtimePermSets.some((s) => s.code === "OPS")).toBe(true);
  });

  it("name / description 改了 (permissions 没动) → 不触发失效", async () => {
    await updateRole(adminUser, "r-sales", { name: "新名称" });
    expect(mockState.roleVersionUpdates).toEqual([]);
    expect(mockState.cacheInvalidations).toEqual([]);
    expect(mockState.runtimePermSets).toEqual([]);
  });
});

describe("updateRole - code 重命名护栏", () => {
  it("code 改成已存在 → 409", async () => {
    await expect(
      updateRole(adminUser, "r-sales", { code: "ADMIN" })
    ).rejects.toThrow(/已被使用/);
  });

  it("系统角色 code 改成 RoleCode 联合外的值 → 400", async () => {
    await expect(
      updateRole(adminUser, "r-sales", { code: "GUEST" })
    ).rejects.toThrow(/系统角色代码必须是/);
  });

  it("系统角色 code 在联合内 (SALES→OPS) → 通过", async () => {
    const r = await updateRole(adminUser, "r-sales", { code: "OPS" });
    expect(r.code).toBe("OPS");
  });
});

describe("updateRole - 审计", () => {
  it("写 audit, before/after 含 permissionsCount", async () => {
    await updateRole(adminUser, "r-sales", {
      permissions: [{ resource: "CONTRACT", actions: ["READ"] }]
    });
    expect(mockState.audits).toHaveLength(1);
    const a = mockState.audits[0]!;
    expect(a.action).toBe("ROLE_UPDATE");
    expect(a.entity).toBe("Role");
    expect(a.entityId).toBe("r-sales");
    expect((a.before as { permissionsCount: number }).permissionsCount).toBe(1);
    expect((a.after as { permissionsCount: number }).permissionsCount).toBe(1);
  });
});

describe("deleteRole - 清缓存", () => {
  it("删除自定义角色 → clearRuntimePermissions + invalidateRolePermCache", async () => {
    mockState.roles.set("r-custom", {
      id: "r-custom",
      code: "CUSTOM",
      name: "Custom",
      description: null,
      permissions: [{ resource: "USER", actions: ["READ"] }],
      isSystem: false
    });
    await deleteRole(adminUser, "r-custom");
    expect(mockState.rolePermCacheInvalidations).toContain("CUSTOM");
    expect(mockState.runtimePermClears).toContain("CUSTOM");
  });
});
