// 轻量 i18n：当前默认 zh-CN；en-US 预览
// 用法：const t = useT(); t("menu.dashboard")
// 字典在 lib/i18n/zh-CN.ts 和 lib/i18n/en-US.ts

export type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "menu.dashboard": "工作台",
    "menu.customers": "客户管理",
    "menu.contracts": "合同管理",
    "menu.invoices": "开票管理",
    "menu.payments": "回款管理",
    "menu.statistics": "统计分析",
    "menu.messages": "消息中心",
    "menu.announcements": "公告",
    "menu.admin": "系统管理",
    "menu.assets": "企业资产",
    "assetType.LICENSE": "营业执照",
    "assetType.CERTIFICATE": "资质证书",
    "assetType.QUALIFICATION": "认证体系",
    "assetType.PERFORMANCE": "业绩证明",
    "assetType.TEAM_MEMBER": "团队成员",
    "assetType.CASE": "项目案例",
    "assetType.PATENT": "专利软著",
    "assetType.OTHER": "其他",
    "assetStatus.VALID": "有效",
    "assetStatus.EXPIRING_SOON": "即将到期",
    "assetStatus.EXPIRED": "已过期",
    "assetStatus.ARCHIVED": "已归档",
    "common.contractAmount": "合同额",
    "common.invoiceAmount": "已开票额",
    "common.paymentAmount": "已回款额",
    "common.unpaid": "未回款",
    "status.LEAD": "线索",
    "status.NEGOTIATING": "洽谈中",
    "status.SIGNED": "已签约",
    "status.LOST": "已流失",
    "status.FROZEN": "已冻结",
    "status.DRAFT": "草稿",
    "status.PENDING_REVIEW": "待审批",
    "status.EFFECTIVE": "生效中",
    "status.EXECUTING": "执行中",
    "status.COMPLETED": "已完成",
    "status.TERMINATED": "已终止",
    "status.EXPIRED": "已过期",
    "status.ISSUED": "已开票",
    "status.VOIDED": "已作废",
    "status.RED_FLUSHED": "已红冲",
    "status.REJECTED": "已驳回",
    "status.PENDING_FINANCE": "待财务开票",
    "status.PLANNED": "待收",
    "status.CONFIRMED": "已确认",
    "status.RECONCILED": "已对账",
    "status.REFUNDED": "已退款",
    "status.CANCELLED": "已取消"
  },
  "en-US": {
    "menu.dashboard": "Dashboard",
    "menu.customers": "Customers",
    "menu.contracts": "Contracts",
    "menu.invoices": "Invoices",
    "menu.payments": "Payments",
    "menu.statistics": "Statistics",
    "menu.messages": "Messages",
    "menu.announcements": "Announcements",
    "menu.admin": "Admin",
    "menu.assets": "Company Assets",
    "assetType.LICENSE": "Business License",
    "assetType.CERTIFICATE": "Qualification",
    "assetType.QUALIFICATION": "Certification",
    "assetType.PERFORMANCE": "Performance",
    "assetType.TEAM_MEMBER": "Team Member",
    "assetType.CASE": "Case Study",
    "assetType.PATENT": "Patent / IP",
    "assetType.OTHER": "Other",
    "assetStatus.VALID": "Valid",
    "assetStatus.EXPIRING_SOON": "Expiring Soon",
    "assetStatus.EXPIRED": "Expired",
    "assetStatus.ARCHIVED": "Archived",
    "common.contractAmount": "Contract Amount",
    "common.invoiceAmount": "Invoiced",
    "common.paymentAmount": "Received",
    "common.unpaid": "Unpaid",
    "status.LEAD": "Lead",
    "status.NEGOTIATING": "Negotiating",
    "status.SIGNED": "Signed",
    "status.LOST": "Lost",
    "status.FROZEN": "Frozen",
    "status.DRAFT": "Draft",
    "status.PENDING_REVIEW": "Pending",
    "status.EFFECTIVE": "Effective",
    "status.EXECUTING": "Executing",
    "status.COMPLETED": "Completed",
    "status.TERMINATED": "Terminated",
    "status.EXPIRED": "Expired",
    "status.ISSUED": "Issued",
    "status.VOIDED": "Voided",
    "status.RED_FLUSHED": "Red-flushed",
    "status.REJECTED": "Rejected",
    "status.PENDING_FINANCE": "Pending Finance",
    "status.PLANNED": "Planned",
    "status.CONFIRMED": "Confirmed",
    "status.RECONCILED": "Reconciled",
    "status.REFUNDED": "Refunded",
    "status.CANCELLED": "Cancelled"
  }
};

export function getT(locale: Locale = "zh-CN") {
  return (key: string): string => messages[locale]?.[key] ?? messages["zh-CN"][key] ?? key;
}

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en-US"];
export const DEFAULT_LOCALE: Locale = "zh-CN";

// 客户端：使用 zustand 持久化 locale
// 这里只是一个简单 hook：useT 读 zustand store
