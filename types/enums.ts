// 业务枚举：与 prisma schema 字符串字段对齐；应用层用 TS 联合类型 + Zod 校验双重保险。

export const USER_STATUS = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const GENDER = ["MALE", "FEMALE", "OTHER"] as const;
export type Gender = (typeof GENDER)[number];

export const EMPLOYMENT_TYPE = ["FULL_TIME", "PART_TIME", "INTERN", "CONTRACTOR"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPE)[number];

export const CUSTOMER_TYPE = ["ENTERPRISE", "GOV", "OTHER"] as const;
export type CustomerType = (typeof CUSTOMER_TYPE)[number];

export const CUSTOMER_SCALE = ["LARGE", "MEDIUM", "SMALL", "MICRO"] as const;
export type CustomerScale = (typeof CUSTOMER_SCALE)[number];


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
  "SYS_BUILDING",
  "RESIDENT",
  "SURVEY",
  "STANDARDIZATION",
  "OTHER"
] as const;
export type ServiceType = (typeof SERVICE_TYPE)[number];

export const CONTRACT_STATUS = [
  "DRAFT",
  "ACTIVE",
  "CLOSED"
] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

export const CONTRACT_PAYMENT_METHOD = ["LUMP_SUM", "BY_PHASE", "BY_MONTH", "BY_QUARTER"] as const;
export type ContractPaymentMethod = (typeof CONTRACT_PAYMENT_METHOD)[number];

export const REVIEW_ACTION = ["SUBMIT", "APPROVE", "REJECT", "WITHDRAW"] as const;
export type ReviewAction = (typeof REVIEW_ACTION)[number];

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

/* === 合同开票状态(派生字段:由 invoicedAmount 与 totalAmount 比较得出,不入库) === */
export const BILLING_STATUS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;
export type BillingStatus = (typeof BILLING_STATUS)[number];

/* === 合同回款状态(派生字段:由 paidAmount 与 totalAmount 比较得出,不入库) ===
 * 与 PaymentStatus (per-payment lifecycle 5 态: PLANNED/CONFIRMED/RECONCILED/REFUNDED/CANCELLED) 不同:
 * 这里描述的是合同级回款进度,只关心 paid/total 比例,3 态。 */
export const PAYMENT_PROGRESS_STATUS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;
export type PaymentProgressStatus = (typeof PAYMENT_PROGRESS_STATUS)[number];

// 通知事件类型:与 prisma schema 的 enum MessageType 一一对应
// (bus.ts 的 DomainEventType 直接派生自这里,确保运行时与编译期一致)
export const MESSAGE_TYPE = [
  "CONTRACT_EXPIRING",
  "INVOICE_OVERDUE_PAYMENT",
  "PAYMENT_RECEIVED",
  "CUSTOMER_STATUS_SUGGEST",
  "CONTRACT_AUTO_EXECUTED",
  "CONTRACT_AUTO_COMPLETED",
  "CONTRACT_AUTO_EXPIRED",
  // 合同过期宽限期强关 (tryAutoCloseOnOverdue 触发, endDate+GRACE<now 仍未结清)
  "CONTRACT_AUTO_OVERDUE_TERMINATED",
  // 合同过期未结清提醒 (tickStaleContracts 触发, endDate<now 但钱没收齐, 给 owner/admin 通知)
  "CONTRACT_EXPIRED_UNPAID",
  // 证书 N 天内到期提醒 (server/jobs/certificate-expiry-check 触发)
  "CERTIFICATE_EXPIRING",
  // 客户状态机自动化: 系统自动写客户状态后, 给 owner 发的通知
  "CUSTOMER_STATUS_AUTO_APPLIED",
  // 客户状态机自动化: owner 在撤销窗口期内撤销了系统自动写, 给 owner 的反馈
  "CUSTOMER_STATUS_AUTO_REVERTED"
] as const;

// 5 个内置角色
export const ROLE_CODES = ["ADMIN", "SALES", "FINANCE", "OPS", "EXPERT"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

