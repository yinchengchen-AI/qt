/* 业务枚举码 → 中文标签的静态映射
 * - 这里只放数据库/代码层面强约定的固定枚举
 * - 业务上由 admin 在"数据字典"页面维护的类别(行业、客户来源等)走 useDict()
 * - 服务端 / 客户端都可引用,免去两边各写一遍
 */

export const SERVICE_TYPE_MAP: Record<string, string> = {
  SAFETY_CONSULT:    "管理咨询",
  SAFETY_TRAIN:      "宣传教育培训",
  HAZARD_ANA:        "安全隐患排查",
  EMERGENCY_PLAN:    "应急预案/演练",
  EVALUATION:        "安全评估",
  SYS_BUILDING:      "安全体系建设",
  RESIDENT:          "派驻托管服务",
  SURVEY:            "普查核验服务",
  STANDARDIZATION:   "标准化体系创建/换证",
  OTHER:             "其他"
};

export const PAYMENT_METHOD_MAP: Record<string, string> = {
  LUMP_SUM:    "一次性",
  BY_PHASE:    "按阶段",
  BY_MONTH:    "按月",
  BY_QUARTER:  "按季"
};

export const REVIEW_ACTION_MAP: Record<string, string> = {
  SUBMIT:    "提交审批",
  APPROVE:   "批准",
  REJECT:    "驳回",
  WITHDRAW:  "撤回",
  EXECUTE:   "开始执行",
  SUSPEND:   "暂停",
  RESUME:    "恢复",
  COMPLETE:  "结清"
};

export const USER_STATUS_MAP: Record<string, string> = {
  ACTIVE:   "启用",
  DISABLED: "禁用"
};

export const INVOICE_TYPE_MAP: Record<string, string> = {
  VAT_SPECIAL:    "增值税专用发票",
  VAT_GENERAL:    "增值税普通发票",
  VAT_ELECTRONIC: "增值税电子专票",
  ELEC_NORMAL:    "电子普通发票"
};

export const TITLE_TYPE_MAP: Record<string, string> = {
  COMPANY:   "公司",
  PERSONAL:  "个人"
};

export const CUSTOMER_STATUS_MAP: Record<string, string> = {
  LEAD:        "线索",
  NEGOTIATING: "洽谈中",
  SIGNED:      "已签约",
  LOST:        "已流失",
  FROZEN:      "已冻结"
};

export const CONTRACT_STATUS_MAP: Record<string, string> = {
  DRAFT:          "草稿",
  PENDING_REVIEW: "待审批",
  EFFECTIVE:      "已生效",
  EXECUTING:      "执行中",
  COMPLETED:      "已完成",
  TERMINATED:     "已终止",
  EXPIRED:        "已过期"
};

export const PROJECT_STATUS_MAP: Record<string, string> = {
  PLANNED:     "计划中",
  IN_PROGRESS: "进行中",
  SUSPENDED:   "已暂停",
  DELIVERED:   "已交付",
  ACCEPTED:    "已验收",
  CLOSED:      "已关闭",
  CANCELLED:   "已取消"
};

export const METHOD_MAP: Record<string, string> = {
  BANK_TRANSFER: "银行转账",
  CHECK:         "支票",
  CASH:          "现金",
  WECHAT:        "微信",
  ALIPAY:        "支付宝",
  OTHER:         "其他"
};

export function lookup<T extends Record<string, string>>(map: T, code?: string | null): string {
  if (!code) return "";
  return map[code] ?? code;
}

/* === Workflow Engine === */
export const WORKFLOW_PHASE_MAP: Record<string, string> = {
  PREP:        "前期准备",
  REQUIREMENT: "需求识别",
  CONTRACT:    "合同签订",
  EXECUTE:     "服务实施",
  FOLLOWUP:    "回访与改进"
};

export const WORKFLOW_TASK_STATUS_MAP: Record<string, string> = {
  PENDING:     "待开始",
  IN_PROGRESS: "进行中",
  COMPLETED:   "已完成",
  SKIPPED:     "已跳过",
  BLOCKED:     "已阻塞"
};

export const WORKFLOW_REVIEW_STATUS_MAP: Record<string, string> = {
  REVIEWING: "校核中",
  REVIEWED:  "已校核",
  APPROVED:  "已审核",
  REJECTED:  "已驳回"
};

export const WORKFLOW_RECURRENCE_UNIT_MAP: Record<string, string> = {
  DAY:   "天",
  WEEK:  "周",
  MONTH: "月",
  YEAR:  "年"
};

export const WORKFLOW_REQUIRED_ROLE_MAP: Record<string, string> = {
  SALES_LEAD: "业务负责人",
  EXPERT:     "技术专家",
  ADMIN:      "管理员",
  OPS:        "行政"
};

/* === 工作流看板辅助映射 === */
export const WORKFLOW_TASK_STATUS_TONE: Record<string, string> = {
  PENDING:     "default",
  IN_PROGRESS: "processing",
  COMPLETED:   "success",
  SKIPPED:     "warning",
  BLOCKED:     "error"
};

export const WORKFLOW_PHASE_STATE_LABEL: Record<string, string> = {
  DONE:    "已完成",
  PARTIAL: "进行中",
  LOCKED:  "未解锁",
  READY:   "待开始"
};

export const WORKFLOW_PHASE_STATE_TONE: Record<string, string> = {
  DONE:    "success",
  PARTIAL: "processing",
  LOCKED:  "default",
  READY:   "default"
};

export const WORKFLOW_TASK_ACTION_LABEL: Record<string, string> = {
  start:    "开始",
  complete: "完成",
  block:    "阻塞",
  unblock:  "解除",
  skip:     "跳过"
};

export const WORKFLOW_TASK_STATUS_SORT: Record<string, number> = {
  PENDING: 0, IN_PROGRESS: 1, BLOCKED: 2, COMPLETED: 3, SKIPPED: 4
};

