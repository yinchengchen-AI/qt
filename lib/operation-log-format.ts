import type { StatusDomain } from "@/lib/status";

/** 把 ENTITY 字符串映射成人类可读中文标签（用于表格 / 抽屉） */
export const ENTITY_LABELS: Record<string, string> = {
  Announcement: "公告",
  Asset: "企业资产",
  AssetImport: "资产导入",
  Attachment: "附件",
  Contract: "合同",
  Customer: "客户",
  Department: "部门",
  Dictionary: "字典",
  FollowUp: "跟进记录",
  Invoice: "开票",
  Payment: "回款",
  Role: "角色",
  User: "用户",
};

/** Entity -> 详情页相对路径（用于跳转），不存在的 entity 留空表示纯文本 */
export const ENTITY_PATHS: Record<string, string> = {
  Contract: "/contracts",
  Customer: "/customers",
  Invoice: "/invoices",
  Payment: "/payments",
  User: "/admin/users",
  Role: "/admin/roles",
  Department: "/admin/departments",
  Announcement: "/announcements",
  Dictionary: "/admin/dictionaries",
};

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export function entityHref(entity: string, entityId: string): string | null {
  const base = ENTITY_PATHS[entity];
  return base ? `${base}/${entityId}` : null;
}

/** 已知的 action 前缀 -> 业务域；供 StatusTag 染色用 */
export function actionDomain(action: string): StatusDomain | null {
  if (action.startsWith("CONTRACT_")) return "contract";
  if (action.startsWith("INVOICE_")) return "invoice";
  if (action.startsWith("PAYMENT_")) return "payment";
  if (action.startsWith("CUSTOMER_")) return "customer";
  return null;
}

/** CONTRACT_SUBMIT -> SUBMIT, PAYMENT_CONFIRM -> CONFIRM */
export function shortAction(action: string): string {
  const idx = action.indexOf("_");
  return idx >= 0 ? action.slice(idx + 1) : action;
}

/** 已知的"短动作" -> 中文标签；与 shortAction() 配合做 StatusTag label */
const ACTION_LABELS: Record<string, string> = {
  // 合同
  SUBMIT: "提交",
  APPROVE: "通过",
  REJECT: "驳回",
  WITHDRAW: "撤回",
  EXECUTE: "执行",
  SUSPEND: "暂停",
  RESUME: "恢复",
  COMPLETE: "完成",
  TERMINATE: "终止",
  AUTO_EXECUTE: "自动执行",
  AUTO_EXPIRE: "自动过期",
  // 开票
  ISSUE: "开具",
  VOID: "作废",
  RED_FLUSH: "红冲",
  // 回款
  CONFIRM: "确认",
  RECONCILE: "对账",
  REFUND: "退款",
  // 客户
  SOFT_DELETE: "软删",
  RESTORE: "恢复",
  // 通用
  CREATE: "新建",
  UPDATE: "更新",
  DELETE: "删除",
};

export function shortActionLabel(action: string): string {
  return ACTION_LABELS[shortAction(action)] ?? shortAction(action);
}
