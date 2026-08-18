import type { StatusDomain } from "@/lib/status";

/** 把 ENTITY 字符串映射成人类可读中文标签（用于表格 / 抽屉） */
export const ENTITY_LABELS: Record<string, string> = {
  Announcement: "公告",
  Auth: "认证",
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

/** diff 字段名 -> 中文标签（覆盖各实体高频字段；未命中时回退原始字段名） */
export const FIELD_LABELS: Record<string, string> = {
  // 通用
  status: "状态",
  remark: "备注",
  attachments: "附件",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  deletedAt: "删除时间",
  createdById: "创建人",
  updatedById: "更新人",
  // 客户
  code: "客户编号",
  name: "名称",
  customerType: "客户类型",
  province: "省份",
  city: "城市",
  contactPerson: "联系人",
  contactPhone: "联系电话",
  ownerUserId: "负责人",
  level: "客户等级",
  source: "客户来源",
  industry: "行业",
  address: "地址",
  // 合同
  contractNo: "合同编号",
  title: "标题",
  totalAmount: "合同总额",
  signDate: "签订日期",
  startDate: "开始日期",
  endDate: "结束日期",
  customerId: "客户",
  salespersonId: "销售",
  autoCompleteEnabled: "自动完成",
  // 开票
  invoiceNo: "发票号码",
  invoiceCode: "发票代码",
  invoiceType: "发票类型",
  amount: "金额",
  taxRate: "税率",
  taxAmount: "税额",
  amountExcludingTax: "不含税金额",
  applyDate: "申请日期",
  expectedIssueDate: "预计开具日期",
  actualIssueDate: "实际开具日期",
  dueDate: "约定付款日",
  titleType: "抬头类型",
  titleName: "发票抬头",
  applicantUserId: "申请人",
  financeUserId: "财务处理人",
  reviewComment: "审核意见",
  // 回款
  paymentNo: "回款编号",
  receivedAt: "到账日期",
  method: "收款方式",
  bankRefNo: "银行流水号",
  bankName: "开户行",
  recorderUserId: "登记人",
  reconcileUserId: "对账人",
  reconciledAt: "对账时间",
  invoiceId: "关联发票",
  contractId: "关联合同",
  // 用户 / 组织
  employeeNo: "工号",
  email: "邮箱",
  roleId: "角色",
  departmentId: "部门",
  isActive: "是否启用",
  permissions: "权限",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}
