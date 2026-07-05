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
  CERTIFICATE_EXPIRING:      { label: "证书到期", tone: "warning" },
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
