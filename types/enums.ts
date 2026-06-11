// 业务枚举：与 prisma schema 字符串字段对齐；应用层用 TS 联合类型 + Zod 校验双重保险。

export const USER_STATUS = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const CUSTOMER_TYPE = ["ENTERPRISE", "GOV", "OTHER"] as const;
export type CustomerType = (typeof CUSTOMER_TYPE)[number];

export const CUSTOMER_SCALE = ["LARGE", "MEDIUM", "SMALL", "MICRO"] as const;
export type CustomerScale = (typeof CUSTOMER_SCALE)[number];


export const CUSTOMER_STATUS = ["LEAD", "NEGOTIATING", "SIGNED", "LOST", "FROZEN"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS)[number];

export const FOLLOW_METHOD = ["VISIT", "CALL", "WECHAT", "EMAIL", "OTHER"] as const;
export type FollowMethod = (typeof FOLLOW_METHOD)[number];

export const FOLLOW_RESULT = ["INTENT", "NO_INTENT", "PENDING", "SIGNED"] as const;
export type FollowResult = (typeof FOLLOW_RESULT)[number];

export const SERVICE_TYPE = [
  "SAFETY_CONSULT",
  "SAFETY_TRAIN",
  "HAZARD_ANA",
  "EMERGENCY_PLAN",
  "EVALUATION",
  "OTHER"
] as const;
export type ServiceType = (typeof SERVICE_TYPE)[number];

export const CONTRACT_STATUS = [
  "DRAFT",
  "PENDING_REVIEW",
  "EFFECTIVE",
  "EXECUTING",
  "COMPLETED",
  "TERMINATED",
  "EXPIRED"
] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

export const CONTRACT_PAYMENT_METHOD = ["LUMP_SUM", "BY_PHASE", "BY_MONTH", "BY_QUARTER"] as const;
export type ContractPaymentMethod = (typeof CONTRACT_PAYMENT_METHOD)[number];

export const REVIEW_ACTION = ["SUBMIT", "APPROVE", "REJECT", "WITHDRAW"] as const;
export type ReviewAction = (typeof REVIEW_ACTION)[number];

export const PROJECT_STATUS = [
  "PLANNED",
  "IN_PROGRESS",
  "SUSPENDED",
  "DELIVERED",
  "ACCEPTED",
  "CLOSED",
  "CANCELLED"
] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const INVOICE_TYPE = ["VAT_SPECIAL", "VAT_GENERAL", "VAT_ELECTRONIC", "ELEC_NORMAL"] as const;
export type InvoiceType = (typeof INVOICE_TYPE)[number];

export const TITLE_TYPE = ["COMPANY", "PERSONAL"] as const;
export type TitleType = (typeof TITLE_TYPE)[number];

export const INVOICE_STATUS = [
  "DRAFT",
  "PENDING_FINANCE",
  "ISSUED",
  "REJECTED",
  "VOIDED",
  "RED_FLUSHED"
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const PAYMENT_RECEIVE_METHOD = [
  "BANK_TRANSFER",
  "CHECK",
  "CASH",
  "WECHAT",
  "ALIPAY",
  "OTHER"
] as const;
export type PaymentReceiveMethod = (typeof PAYMENT_RECEIVE_METHOD)[number];

export const PAYMENT_STATUS = [
  "PLANNED",
  "CONFIRMED",
  "RECONCILED",
  "REFUNDED",
  "CANCELLED"
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const MESSAGE_TYPE = [
  "CONTRACT_PENDING_REVIEW",
  "CONTRACT_EXPIRING",
  "INVOICE_OVERDUE_PAYMENT",
  "PAYMENT_RECEIVED",
  "PROJECT_DUE",
  "CUSTOMER_INACTIVE"
] as const;
export type MessageType = (typeof MESSAGE_TYPE)[number];

// 4 个内置角色
export const ROLE_CODES = ["ADMIN", "SALES", "FINANCE", "OPS"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
