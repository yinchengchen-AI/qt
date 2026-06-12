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
  WITHDRAW:  "撤回"
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
