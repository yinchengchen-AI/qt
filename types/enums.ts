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
  "SYS_BUILDING",
  "RESIDENT",
  "SURVEY",
  "STANDARDIZATION",
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
  "CONTRACT_APPROVED",
  "CONTRACT_REJECTED",
  "INVOICE_OVERDUE_PAYMENT",
  "PAYMENT_RECEIVED",
  "PROJECT_DUE",
  "CUSTOMER_INACTIVE",
  // 工作流引擎
  "WORKFLOW_TASK_ASSIGNED",
  "WORKFLOW_REVIEW_REQUESTED"
] as const;
export type MessageType = (typeof MESSAGE_TYPE)[number];

// 5 个内置角色 (与 WorkflowTask.requiredRole 共享 code 空间)
export const ROLE_CODES = ["ADMIN", "SALES", "FINANCE", "OPS", "EXPERT"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

// =====================================================
// Workflow Engine (P1)
// =====================================================
// taskStatus: 任务实例状态机
export const WORKFLOW_TASK_STATUS = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "BLOCKED"
] as const;
export type WorkflowTaskStatus = (typeof WORKFLOW_TASK_STATUS)[number];

// reviewStatus: requiresTwoStepReview=true 的任务使用
export const WORKFLOW_REVIEW_STATUS = [
  "REVIEWING",
  "REVIEWED",
  "APPROVED",
  "REJECTED"
] as const;
export type WorkflowReviewStatus = (typeof WORKFLOW_REVIEW_STATUS)[number];

// recurrenceUnit: 循环任务周期
export const WORKFLOW_RECURRENCE_UNIT = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type WorkflowRecurrenceUnit = (typeof WORKFLOW_RECURRENCE_UNIT)[number];

// taskAction: 服务端允许的实例动作
export const WORKFLOW_TASK_ACTIONS = [
  "start",
  "complete",
  "block",
  "unblock",
  "skip"
] as const;
export type WorkflowTaskAction = (typeof WORKFLOW_TASK_ACTIONS)[number];

// reviewAction: 二审动作
export const WORKFLOW_REVIEW_ACTIONS = ["submit", "approve", "reject"] as const;
export type WorkflowReviewAction = (typeof WORKFLOW_REVIEW_ACTIONS)[number];

// phase 严格顺序(P3 阶段锁定用);空数组 = 无前置
export const WORKFLOW_PHASE_ORDER = ["PREP", "REQUIREMENT", "CONTRACT", "EXECUTE", "FOLLOWUP"] as const;
export type WorkflowPhase = (typeof WORKFLOW_PHASE_ORDER)[number];

// 锁定状态:DONE 全部完成;PARTIAL 部分完成;LOCKED 前置未达;READY 可开始
export const WORKFLOW_PHASE_STATE = ["DONE", "PARTIAL", "LOCKED", "READY"] as const;
export type WorkflowPhaseState = (typeof WORKFLOW_PHASE_STATE)[number];
