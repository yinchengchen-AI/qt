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
  // 历史 CUSTOMER_STATUS_* / CUSTOMER_AUTO_* action 仍保留, 但 StatusDomain 已无 customer
  // 返回 null 让 StatusTag 走默认色, 标签由调用方自己决定 (一般是 action 本身)
  if (action.startsWith("CUSTOMER_")) return null;
  return null;
}

/** CONTRACT_SUBMIT -> SUBMIT, PAYMENT_CONFIRM -> CONFIRM */
export function shortAction(action: string): string {
  const idx = action.indexOf("_");
  return idx >= 0 ? action.slice(idx + 1) : action;
}

export type ActionTone = "success" | "processing" | "error" | "warning" | "default";

const ACTION_META: Record<string, { label: string; tone: ActionTone }> = {
  // 合同
  SUBMIT: { label: "提交", tone: "default" },
  APPROVE: { label: "通过", tone: "success" },
  REJECT: { label: "驳回", tone: "error" },
  WITHDRAW: { label: "撤回", tone: "default" },
  EXECUTE: { label: "执行", tone: "processing" },
  SUSPEND: { label: "暂停", tone: "warning" },
  RESUME: { label: "恢复", tone: "processing" },
  COMPLETE: { label: "完成", tone: "success" },
  TERMINATE: { label: "终止", tone: "error" },
  AUTO_EXECUTE: { label: "自动执行", tone: "processing" },
  AUTO_EXPIRE: { label: "自动过期", tone: "default" },
  // 开票
  ISSUE: { label: "开具", tone: "success" },
  VOID: { label: "作废", tone: "warning" },
  RED_FLUSH: { label: "红冲", tone: "error" },
  // 回款
  CONFIRM: { label: "确认", tone: "success" },
  RECONCILE: { label: "对账", tone: "success" },
  REFUND: { label: "退款", tone: "warning" },
  // 客户
  SOFT_DELETE: { label: "软删", tone: "warning" },
  RESTORE: { label: "恢复", tone: "success" },
  // 通用
  CREATE: { label: "新建", tone: "success" },
  UPDATE: { label: "更新", tone: "default" },
  DELETE: { label: "删除", tone: "error" },
};

export function shortActionLabel(action: string): string {
  return ACTION_META[shortAction(action)]?.label ?? shortAction(action);
}

export function shortActionTone(action: string): ActionTone {
  return ACTION_META[shortAction(action)]?.tone ?? "default";
}
