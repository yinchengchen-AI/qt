// 资源 × 操作 × 角色 权限矩阵
//
// 真源 (since v0.18.3):
//   - 运行时权限以 DB Role.permissions 为准, admin 可在 /admin/roles 直接调整
//   - 本文件 ROLE_PERMISSIONS 仅作:
//       1) 启动/bootstrap: scripts/shared/seed-roles.ts 把这份矩阵 upsert 到 DB
//       2) 兜底: DB 不可用 / runtimeCache 未命中时回退到这里
//       3) 类型安全: 给 RESOURCE / ACTION 提供穷尽的枚举与默认值
//   - lib/auth.ts 的 session callback 每次请求把 DB 当前权限灌进下面的 runtimeCache,
//     requirePermission(roleCode, ...) 先查 cache, 再兜底查 ROLE_PERMISSIONS.
//   - 修改某个角色的权限后, server/services/role.ts#updateRole 会:
//       a) bump 所有该角色用户的 User.roleVersion (让客户端感知 epoch 变化)
//       b) invalidateAuthCache(uid) 清掉该用户 2s 内的 userCache (下一请求重读 DB)
//       c) setRuntimePermissions(roleCode, newPerms) 立即让本进程其他用户拿到新权限
//     通常在下一个请求 (≤2s 内) 全员拿到新权限; 角色代码 / 名称 / 描述 改动不涉及权限,
//     因此不需要失效.
import { ERROR_CODES } from "@/types/errors";
import type { RoleCode } from "@/types/enums";
import { ApiError } from "./api";

export const RESOURCE = {
  USER: "USER",
  ROLE: "ROLE",
  DICTIONARY: "DICTIONARY",
  CUSTOMER: "CUSTOMER",
  CONTRACT: "CONTRACT",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  STATISTICS: "STATISTICS",
  MESSAGE: "MESSAGE",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  OPERATION_LOG: "OPERATION_LOG",
  DEPARTMENT: "DEPARTMENT",
  DUNNING: "DUNNING",
  APP_RELEASE: "APP_RELEASE",
} as const;
export type Resource = (typeof RESOURCE)[keyof typeof RESOURCE];

export const ACTION = {
  READ: "READ",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXPORT: "EXPORT"
} as const;
export type Action = (typeof ACTION)[keyof typeof ACTION];

export type Permission = { resource: Resource; actions: Action[] };

const CRUD: Action[] = ["READ", "CREATE", "UPDATE", "DELETE"];
const CRU: Action[] = ["READ", "CREATE", "UPDATE"];
const CR: Action[] = ["READ", "CREATE"];
const R: Action[] = ["READ"];
const R_EXPORT: Action[] = ["READ", "EXPORT"];

// 内置角色默认权限 — 仅作 seed bootstrap + DB 不可用时的兜底, 运行时以 DB 为准
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: Object.values(RESOURCE).map((resource) =>
    resource === RESOURCE.STATISTICS || resource === RESOURCE.CUSTOMER || resource === RESOURCE.CONTRACT ||
    resource === RESOURCE.INVOICE || resource === RESOURCE.PAYMENT || resource === RESOURCE.DUNNING
      ? { resource, actions: [...CRUD, ACTION.EXPORT] }
      : { resource, actions: CRUD }
  ),
  SALES: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...CR, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    // 催收: 业务现场记录进度(增 / 查), 修改与清理由财务负责.
    { resource: RESOURCE.DUNNING, actions: CR },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.APP_RELEASE, actions: R },
  ],
  FINANCE: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...CRUD, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...CRUD, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R_EXPORT },
    // 催收: 财务对账合规留痕, 拿全 CRUD; 业务仅可新增/查询.
    { resource: RESOURCE.DUNNING, actions: CRUD },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.APP_RELEASE, actions: R },
  ],
  OPS: [
    { resource: RESOURCE.DEPARTMENT, actions: CRUD },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    // 客户资料 owner 是销售; 行政只读查阅+导出
    { resource: RESOURCE.CUSTOMER, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    { resource: RESOURCE.DUNNING, actions: R },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: CRUD },
    { resource: RESOURCE.APP_RELEASE, actions: R },
  ],
  // 技术专家: 类似销售跟进自己的客户/合同 (行级隔离同 SALES), 但不管钱 —
  // 发票/回款只读+导出, 催款只读; 商业发起与催收记录归 SALES/财务.
  EXPERT: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...CRU, ACTION.EXPORT] },
    // EXPERT 仅查看开票以了解商务进度, 不创建/改/删; 商业发起统一走 SALES.
    // 仍保留 EXPORT 以便交付完成后能让 EXPERT 拉对账数据.
    { resource: RESOURCE.INVOICE, actions: [...R, ACTION.EXPORT] },
    // 回款: 仅查看/导出自己合同的对账进度; 登记回款归 SALES/财务.
    { resource: RESOURCE.PAYMENT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    // 催收: 仅查看; 现场记录归 SALES, 修改清理由财务负责.
    { resource: RESOURCE.DUNNING, actions: R },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.APP_RELEASE, actions: R },
  ]
};

// ---- 进程级权限缓存 (DB → runtime cache → code matrix 兜底) ----
//
// 为什么不直接每次 DB read:
//   - requirePermission 在每个 service 入口被调用, 高频, 不能每请求都打 DB
//   - lib/auth.ts 的 userCache 已经把 user 身份做了 2s TTL, 权限缓存同寿命
//
// 写入时机:
//   - lib/auth.ts session callback 每次请求把当前 DB Role.permissions 灌进来
//   - server/services/role.ts#updateRole 写入新权限时同步覆盖本进程缓存
//
// 失效策略:
//   - updateRole 后, 同一用户下一请求的 session callback 会再次拉 DB, 自然刷新
//   - 即使 cache 短暂陈旧 (最多 2s), updateRole 自己 setRuntimePermissions 兜底
const runtimePermissions = new Map<string, Permission[]>();

/** 替换/写入 roleCode 对应的运行时权限; lib/auth.ts session callback + role#updateRole 都会调用 */
export function setRuntimePermissions(roleCode: string, perms: Permission[]): void {
  runtimePermissions.set(roleCode, perms);
}

/** 移除 roleCode 的运行时权限; 下次 requirePermission 回退到 ROLE_PERMISSIONS 兜底 (角色删除时调用) */
export function clearRuntimePermissions(roleCode: string): void {
  runtimePermissions.delete(roleCode);
}

/** 仅供测试: 强制清空 (单测间隔离) */
export function _resetRuntimePermissionsForTests(): void {
  runtimePermissions.clear();
}

/** 内部: 解析实际生效的权限列表 (runtime cache → code matrix 兜底) */
function resolvePermissions(role: RoleCode): Permission[] {
  return runtimePermissions.get(role) ?? ROLE_PERMISSIONS[role];
}

export function hasPermission(role: RoleCode, resource: Resource, action: Action): boolean {
  return resolvePermissions(role).some((p) => p.resource === resource && p.actions.includes(action));
}

export function requirePermission(
  role: RoleCode,
  resource: Resource,
  action: Action
): void {
  if (!hasPermission(role, resource, action)) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, `角色 ${role} 无权 ${action} ${resource}`, 403);
  }
}
