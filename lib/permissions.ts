// 资源 × 操作 × 角色 权限矩阵
import { ERROR_CODES } from "@/types/errors";
import type { RoleCode } from "@/types/enums";
import { ApiError } from "./api";

export const RESOURCE = {
  USER: "USER",
  ROLE: "ROLE",
  DICTIONARY: "DICTIONARY",
  CUSTOMER: "CUSTOMER",
  CONTRACT: "CONTRACT",
  PROJECT: "PROJECT",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  STATISTICS: "STATISTICS",
  MESSAGE: "MESSAGE",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  OPERATION_LOG: "OPERATION_LOG",
  DEPARTMENT: "DEPARTMENT",
  WORKFLOW_TEMPLATE: "WORKFLOW_TEMPLATE",
  ASSET: "ASSET"
} as const;
export type Resource = (typeof RESOURCE)[keyof typeof RESOURCE];

export const ACTION = {
  READ: "READ",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXPORT: "EXPORT",
  AUDIT: "AUDIT"
} as const;
export type Action = (typeof ACTION)[keyof typeof ACTION];

export type Permission = { resource: Resource; actions: Action[] };

const CRUD: Action[] = ["READ", "CREATE", "UPDATE", "DELETE"];
const CRU: Action[] = ["READ", "CREATE", "UPDATE"];
const CR: Action[] = ["READ", "CREATE"];
const R: Action[] = ["READ"];
const R_EXPORT: Action[] = ["READ", "EXPORT"];

// 内置角色默认权限（P0 阶段硬编码；后续允许后台编辑）
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: Object.values(RESOURCE).map((resource) =>
    resource === RESOURCE.STATISTICS || resource === RESOURCE.CUSTOMER || resource === RESOURCE.CONTRACT ||
    resource === RESOURCE.PROJECT || resource === RESOURCE.INVOICE || resource === RESOURCE.PAYMENT
      ? { resource, actions: [...CRUD, ACTION.EXPORT] }
      : { resource, actions: CRUD }
  ),
  SALES: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.PROJECT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...CR, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...CR, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.ASSET, actions: R }
  ],
  FINANCE: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.PROJECT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...CRUD, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...CRUD, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R_EXPORT },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.ASSET, actions: R }
  ],
  OPS: [
    { resource: RESOURCE.DEPARTMENT, actions: CRUD },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    // CUSTOMER 金额字段不触碰（P1 阶段在 service 层显式过滤）
    { resource: RESOURCE.CUSTOMER, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.PROJECT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...R, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: CRUD },
    { resource: RESOURCE.ASSET, actions: R }
  ],
  // 技术专家：现场勘查 / 报告撰写等"专业执行"角色,权限与 SALES 同
  EXPERT: [
    { resource: RESOURCE.DEPARTMENT, actions: R },
    { resource: RESOURCE.USER, actions: R },
    { resource: RESOURCE.DICTIONARY, actions: R },
    { resource: RESOURCE.CUSTOMER, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.CONTRACT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.PROJECT, actions: [...CRU, ACTION.EXPORT] },
    { resource: RESOURCE.INVOICE, actions: [...CR, ACTION.EXPORT] },
    { resource: RESOURCE.PAYMENT, actions: [...CR, ACTION.EXPORT] },
    { resource: RESOURCE.STATISTICS, actions: R },
    { resource: RESOURCE.MESSAGE, actions: CRUD },
    { resource: RESOURCE.ANNOUNCEMENT, actions: R },
    { resource: RESOURCE.ASSET, actions: R }
  ]
};

export function hasPermission(role: RoleCode, resource: Resource, action: Action): boolean {
  return ROLE_PERMISSIONS[role].some((p) => p.resource === resource && p.actions.includes(action));
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
