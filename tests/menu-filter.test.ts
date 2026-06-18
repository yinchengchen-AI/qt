// 侧边栏菜单按权限过滤回归测试
// 锁住 #2 修复:
//   旧实现: 全部用户看到同一份完整菜单, 内部管理类入口(员工管理/角色权限/操作日志等)
//     对非 ADMIN 用户可见, 点击会被后端 403, UX 差且暴露内部结构。
//   新实现: filterMenu 根据 user.permissions 过滤, 父组仅在有可见子项时保留。
//
// 这条测试不渲染 React 组件, 直接复用 dashboard-shell 的 filterMenu 行为契约。
//
// 由于 filterMenu 是组件文件内私有函数, 不能直接 import, 这里复制其纯函数逻辑
// 作为契约测试: 任何对 filterMenu 的行为变更必须同步更新这条测试。
import { describe, it, expect } from "vitest";
import { RESOURCE, ACTION, ROLE_PERMISSIONS } from "../lib/permissions";
import type { Action, Resource } from "../lib/permissions";

type MenuItem = {
  path: string;
  name: string;
  permission?: { resource: Resource; action: Action };
  children?: Omit<MenuItem, "children">[];
};

function hasMenuPermission(
  permissions: { resource: Resource; actions: Action[] }[],
  required: { resource: Resource; action: Action } | undefined
): boolean {
  if (!required) return true;
  return permissions.some(
    (p) => p.resource === required.resource && p.actions.includes(required.action)
  );
}

function filterMenu(
  items: MenuItem[],
  permissions: { resource: Resource; actions: Action[] }[]
): MenuItem[] {
  return items.reduce<MenuItem[]>((acc, item) => {
    if (item.children && item.children.length > 0) {
      const children = item.children.filter((c) => hasMenuPermission(permissions, c.permission));
      if (children.length === 0) return acc;
      acc.push({ ...item, children });
    } else if (hasMenuPermission(permissions, item.permission)) {
      acc.push(item);
    }
    return acc;
  }, []);
}

// 模拟完整菜单结构(与 components/dashboard-shell.tsx 保持一致的关键项)
const FULL_MENU: MenuItem[] = [
  { path: "/dashboard", name: "工作台" },
  {
    path: "/admin",
    name: "员工管理",
    children: [
      { path: "/admin/users", name: "员工列表", permission: { resource: RESOURCE.USER, action: ACTION.CREATE } },
      { path: "/admin/roles", name: "角色权限", permission: { resource: RESOURCE.ROLE, action: ACTION.CREATE } },
      { path: "/admin/departments", name: "部门管理", permission: { resource: RESOURCE.DEPARTMENT, action: ACTION.CREATE } }
    ]
  },
  {
    path: "/system",
    name: "系统",
    children: [
      { path: "/admin/operation-logs", name: "操作日志", permission: { resource: RESOURCE.OPERATION_LOG, action: ACTION.READ } },
      { path: "/admin/trash", name: "回收站", permission: { resource: RESOURCE.ROLE, action: ACTION.CREATE } }
    ]
  }
];

describe("filterMenu 行为契约", () => {
  it("ADMIN 看到所有菜单项", () => {
    const r = filterMenu(FULL_MENU, ROLE_PERMISSIONS.ADMIN);
    const allPaths = r.flatMap((m) => [m.path, ...(m.children?.map((c) => c.path) ?? [])]);
    expect(allPaths).toContain("/dashboard");
    expect(allPaths).toContain("/admin/users");
    expect(allPaths).toContain("/admin/roles");
    expect(allPaths).toContain("/admin/departments");
    expect(allPaths).toContain("/admin/operation-logs");
    expect(allPaths).toContain("/admin/trash");
  });

  it("SALES 只看到工作台(所有管理类入口被过滤)", () => {
    const r = filterMenu(FULL_MENU, ROLE_PERMISSIONS.SALES);
    const allPaths = r.flatMap((m) => [m.path, ...(m.children?.map((c) => c.path) ?? [])]);
    expect(allPaths).toContain("/dashboard");
    expect(allPaths).not.toContain("/admin/users");
    expect(allPaths).not.toContain("/admin/roles");
    expect(allPaths).not.toContain("/admin/departments");
    expect(allPaths).not.toContain("/admin/operation-logs");
    expect(allPaths).not.toContain("/admin/trash");
  });

  it("OPS 看到部门管理(DEPARTMENT.CREATE), 但看不到用户/角色/操作日志/回收站", () => {
    const r = filterMenu(FULL_MENU, ROLE_PERMISSIONS.OPS);
    const allPaths = r.flatMap((m) => [m.path, ...(m.children?.map((c) => c.path) ?? [])]);
    expect(allPaths).toContain("/admin/departments");
    expect(allPaths).not.toContain("/admin/users");
    expect(allPaths).not.toContain("/admin/roles");
    expect(allPaths).not.toContain("/admin/operation-logs");
    expect(allPaths).not.toContain("/admin/trash");
  });

  it("无 permission 字段的菜单项(无脑全可见)始终保留", () => {
    const r = filterMenu(FULL_MENU, ROLE_PERMISSIONS.FINANCE);
    const dashItem = r.find((m) => m.path === "/dashboard");
    expect(dashItem).toBeDefined();
  });

  it("父组在所有子项都被过滤时整体隐藏", () => {
    const r = filterMenu(FULL_MENU, ROLE_PERMISSIONS.SALES);
    const systemGroup = r.find((m) => m.path === "/system");
    expect(systemGroup).toBeUndefined();
  });
});
