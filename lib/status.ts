/* 业务状态色板集中映射。StatusTag 和 valueEnum 都消费这里。 */

export type StatusDomain =
  | "customer"
  | "contract"
  | "invoice"
  | "payment"
  | "message"
  | "announcement"
  | "asset";

export type Tone = "default" | "info" | "processing" | "success" | "warning" | "danger";

export type StatusMeta = {
  label: string;
  tone: Tone;
};
/* === Customer === */
const CUSTOMER: Record<string, StatusMeta> = {
  LEAD:        { label: "线索",     tone: "default" },
  NEGOTIATING: { label: "洽谈中",   tone: "processing" },
  SIGNED:      { label: "已签约",   tone: "success" },
  LOST:        { label: "已流失",   tone: "warning" },
  FROZEN:      { label: "已冻结",   tone: "danger" }
};

/* === Contract === */
const CONTRACT: Record<string, StatusMeta> = {
  DRAFT:            { label: "草稿",     tone: "default" },
  PENDING_REVIEW:   { label: "待审批",   tone: "processing" },
  EFFECTIVE:        { label: "已生效",   tone: "info" },
  EXECUTING:        { label: "执行中",   tone: "processing" },
  SUSPENDED:        { label: "已暂停",   tone: "warning" },
  COMPLETED:        { label: "已完成",   tone: "success" },
  TERMINATED:       { label: "已终止",   tone: "danger" },
  EXPIRED:          { label: "已过期",   tone: "warning" }
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
  CONTRACT_PENDING_REVIEW: { label: "待审批",     tone: "info" },
  CONTRACT_EXPIRING:       { label: "合同到期",   tone: "warning" },
  CONTRACT_APPROVED:       { label: "已通过",     tone: "success" },
  CONTRACT_REJECTED:       { label: "已驳回",     tone: "danger" },
  INVOICE_OVERDUE_PAYMENT: { label: "开票超期",   tone: "danger" },
  PAYMENT_RECEIVED:        { label: "回款",       tone: "success" },
  CUSTOMER_INACTIVE:       { label: "客户静默",   tone: "default" },
  ASSET_EXPIRING:            { label: "资产到期",   tone: "warning" },
};

const ANNOUNCEMENT: Record<string, StatusMeta> = {
  PUBLISHED:  { label: "已发布",  tone: "success" },
  SCHEDULED:  { label: "待发布",  tone: "processing" },
  EXPIRED:    { label: "已过期",  tone: "default" },
  DRAFT:      { label: "草稿",    tone: "default" }
};

const ASSET: Record<string, StatusMeta> = {
  VALID:         { label: "有效",       tone: "success" },
  EXPIRING_SOON: { label: "即将到期",   tone: "warning" },
  EXPIRED:       { label: "已过期",     tone: "danger" },
  ARCHIVED:      { label: "已归档",     tone: "default" }
};

const DOMAIN_MAP: Record<StatusDomain, Record<string, StatusMeta>> = {
  customer: CUSTOMER,
  contract: CONTRACT,
  invoice: INVOICE,
  payment: PAYMENT,
  message: MESSAGE,
  announcement: ANNOUNCEMENT,
  asset: ASSET
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
  OPS: "行政"
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
