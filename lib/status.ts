/* 业务状态色板集中映射。StatusTag 和 valueEnum 都消费这里。 */

export type StatusDomain =
  | "contract"
  | "invoice"
  | "payment"
  | "message"
  ;

export type Tone = "default" | "info" | "processing" | "success" | "warning" | "danger";

export type StatusMeta = {
  label: string;
  tone: Tone;
};
/* === Contract === */
const CONTRACT: Record<string, StatusMeta> = {
  DRAFT:   { label: "草稿",   tone: "default" },
  ACTIVE:  { label: "生效中", tone: "processing" },
  CLOSED:  { label: "已完结", tone: "success" }
};

/* === Invoice === */
const INVOICE: Record<string, StatusMeta> = {
  DRAFT:             { label: "草稿",       tone: "default" },
  PENDING_FINANCE:   { label: "财务待审",   tone: "processing" },
  ISSUED:            { label: "已开票",     tone: "success" },
  REJECTED:          { label: "已驳回",     tone: "danger" },
  VOIDED:            { label: "已作废",     tone: "warning" },
  RED_FLUSHED:       { label: "已红冲",     tone: "danger" }
};

/* === Payment === */
const PAYMENT: Record<string, StatusMeta> = {
  PLANNED:    { label: "计划中",   tone: "default" },
  CONFIRMED:  { label: "已确认",   tone: "processing" },
  RECONCILED: { label: "已对账",   tone: "success" },
  REFUNDED:   { label: "已退款",   tone: "warning" },
  CANCELLED:  { label: "已取消",   tone: "danger" }
};

/* === Message === */
const MESSAGE: Record<string, StatusMeta> = {
  CONTRACT_EXPIRING:         { label: "合同到期", tone: "warning" },
  INVOICE_OVERDUE_PAYMENT:   { label: "开票超期", tone: "danger" },
  PAYMENT_RECEIVED:          { label: "回款",     tone: "success" },
  CONTRACT_AUTO_EXECUTED:    { label: "自动执行", tone: "processing" },
  CONTRACT_AUTO_COMPLETED:   { label: "自动结清", tone: "success" },
  CONTRACT_AUTO_EXPIRED:     { label: "自动到期", tone: "default" },
  CONTRACT_AUTO_OVERDUE_TERMINATED: { label: "超期强关", tone: "danger" },
  CONTRACT_EXPIRED_UNPAID:   { label: "到期未结清", tone: "warning" },
  CONTRACT_PAID_INVOICE_PENDING: { label: "待补开票", tone: "warning" },
  CERTIFICATE_EXPIRING:      { label: "证书到期", tone: "warning" },
  INVOICE_ISSUED:            { label: "已开票",   tone: "success" },
  INVOICE_REJECTED:          { label: "开票驳回", tone: "danger" },
  // 对账中心 (bank-reconciliation, 应用层枚举)
  RECONCILIATION_AUTO_MATCHED:   { label: "对账自动匹配", tone: "success" },
  RECONCILIATION_SUGGESTION:     { label: "对账建议", tone: "info" },
  RECONCILIATION_DISCREPANCY:    { label: "对账差异", tone: "danger" },
  RECONCILIATION_WEEKLY_REPORT:  { label: "对账周报", tone: "info" },
  // 合同风险等级上调 (risk-score-snapshot job)
  RISK_LEVEL_UP:                 { label: "风险升级", tone: "danger" },
  // 续签提醒 / 联动补盲 (contract-renewal-remind / daily-linkage-check jobs)
  CONTRACT_RENEWAL_REMIND:       { label: "续签提醒", tone: "warning" },
  LINKAGE_NO_INVOICE:            { label: "联动无发票", tone: "warning" },
  LINKAGE_INVOICE_PAYMENT_GAP:   { label: "联动票款缺口", tone: "danger" },
  // 已下线类型 (v0.5.0 客户状态机迁移; 历史数据仍可能出现在归档/回收站, 保留渲染)
  CUSTOMER_STATUS_SUGGEST:       { label: "客户状态建议", tone: "info" },
  CUSTOMER_STATUS_AUTO_APPLIED:  { label: "状态自动应用", tone: "processing" },
  CUSTOMER_STATUS_AUTO_REVERTED: { label: "状态自动回退", tone: "default" },
};

const DOMAIN_MAP: Record<StatusDomain, Record<string, StatusMeta>> = {
  contract: CONTRACT,
  invoice: INVOICE,
  payment: PAYMENT,
  message: MESSAGE,
};

export function formatStatus(code: string | null | undefined, domain: StatusDomain): StatusMeta {
  if (!code) return { label: "-", tone: "default" };
  const palette = DOMAIN_MAP[domain];
  return palette[code] ?? { label: code, tone: "default" };
}

/** 角色 / 字典类的简短标签(供 valueEnum / select 等用) */

/** 角色标签(供 valueEnum / select 等用) */
export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "管理员",
  SALES: "业务",
  FINANCE: "财务",
  OPS: "行政",
  EXPERT: "技术专家"
};

/** 形如 [{ value: 'DRAFT', label: '草稿' }] 的下拉选项;供 ProFormSelect / Select 使用 */
export function getStatusOptions(
  domain: StatusDomain,
  filter?: (code: string) => boolean
): { value: string; label: string }[] {
  const palette = DOMAIN_MAP[domain];
  return Object.entries(palette)
    .filter(([code]) => (filter ? filter(code) : true))
    .map(([code, meta]) => ({ value: code, label: meta.label }));
}
