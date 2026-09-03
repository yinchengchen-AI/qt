// 消息中心 v2：把 20+ MessageType 按业务域分组成 6 类，前后端共用同一份映射。
//
// 用途：
//   - 前端左侧 sidebar 分类 tab + 顶部 chip 过滤
//   - 后端 listMessages / unreadSummary 的 where 过滤
//   - 偏好设置页面按 category 分组渲染
//
// 增减规则：
//   - 加新 MessageType 必须显式落入某个 category；落到 "unknown" 视为遗漏
//   - DEPRECATED_TYPES 用于 v0.5.0 已下线的 CUSTOMER_STATUS_*，保留渲染但不让用户开关
import { MESSAGE_TYPE } from "@/types/enums";

export const MESSAGE_CATEGORY = {
  CONTRACT: "contract",
  FINANCE: "finance",
  RECONCILIATION: "reconciliation",
  CERTIFICATE: "certificate",
  SYSTEM: "system",
  UNKNOWN: "unknown"
} as const;

export type MessageCategory = (typeof MESSAGE_CATEGORY)[keyof typeof MESSAGE_CATEGORY];

const MAPPING: Record<string, MessageCategory> = {
  // 合同域（含状态机、风险、续签、联动）
  CONTRACT_EXPIRING: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_AUTO_EXECUTED: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_AUTO_COMPLETED: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_AUTO_EXPIRED: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_AUTO_OVERDUE_TERMINATED: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_EXPIRED_UNPAID: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_PAID_INVOICE_PENDING: MESSAGE_CATEGORY.CONTRACT,
  RISK_LEVEL_UP: MESSAGE_CATEGORY.CONTRACT,
  CONTRACT_RENEWAL_REMIND: MESSAGE_CATEGORY.CONTRACT,
  LINKAGE_NO_INVOICE: MESSAGE_CATEGORY.CONTRACT,
  LINKAGE_INVOICE_PAYMENT_GAP: MESSAGE_CATEGORY.CONTRACT,
  // 财务（开票/回款）
  INVOICE_OVERDUE_PAYMENT: MESSAGE_CATEGORY.FINANCE,
  PAYMENT_RECEIVED: MESSAGE_CATEGORY.FINANCE,
  INVOICE_ISSUED: MESSAGE_CATEGORY.FINANCE,
  INVOICE_REJECTED: MESSAGE_CATEGORY.FINANCE,
  // 对账中心
  RECONCILIATION_AUTO_MATCHED: MESSAGE_CATEGORY.RECONCILIATION,
  RECONCILIATION_SUGGESTION: MESSAGE_CATEGORY.RECONCILIATION,
  RECONCILIATION_DISCREPANCY: MESSAGE_CATEGORY.RECONCILIATION,
  RECONCILIATION_WEEKLY_REPORT: MESSAGE_CATEGORY.RECONCILIATION,
  // 员工证书
  CERTIFICATE_EXPIRING: MESSAGE_CATEGORY.CERTIFICATE,
  // 系统预留（未来扩展）
  // system 类暂为空
};

// 已在 Prisma enum 留名但已下线的类型（v0.5.0 客户状态机迁移）
const DEPRECATED_TYPES: ReadonlySet<string> = new Set([
  "CUSTOMER_STATUS_SUGGEST",
  "CUSTOMER_STATUS_AUTO_APPLIED",
  "CUSTOMER_STATUS_AUTO_REVERTED"
]);

export function categoryOf(type: string): MessageCategory {
  if (DEPRECATED_TYPES.has(type)) return MESSAGE_CATEGORY.UNKNOWN;
  return MAPPING[type] ?? MESSAGE_CATEGORY.UNKNOWN;
}

/** 全部应用层可见的 type 集合（含已下线类型） */
export const ALL_MESSAGE_TYPES: readonly string[] = MESSAGE_TYPE;

/** 排除已下线类型，给订阅设置页展示 */
export const SUBSCRIBABLE_MESSAGE_TYPES: readonly string[] = MESSAGE_TYPE.filter(
  (t) => !DEPRECATED_TYPES.has(t)
);

/** 判断一个 type 是否允许在订阅设置里出现（用户能开关） */
export function isSubscribable(type: string): boolean {
  return SUBSCRIBABLE_MESSAGE_TYPES.includes(type);
}

/** 校验 category 值是否合法 */
export function isMessageCategory(v: unknown): v is MessageCategory {
  return (
    typeof v === "string" &&
    Object.values(MESSAGE_CATEGORY).includes(v as MessageCategory)
  );
}
