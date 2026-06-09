// 轻量 i18n：当前默认 zh-CN；en-US 预览
// 用法：const t = useT(); t("menu.dashboard")
// 字典在 lib/i18n/zh-CN.ts 和 lib/i18n/en-US.ts

export type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "menu.dashboard": "工作台",
    "menu.customers": "客户管理",
    "menu.contracts": "合同管理",
    "menu.projects": "项目管理",
    "menu.invoices": "开票管理",
    "menu.payments": "回款管理",
    "menu.statistics": "统计分析",
    "menu.messages": "消息中心",
    "menu.announcements": "公告",
    "menu.admin": "系统管理",
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
    "status.CANCELLED": "已取消",
    "status.PLANNED_PROJECT": "未启动",
    "status.IN_PROGRESS": "进行中",
    "status.SUSPENDED": "已暂停",
    "status.DELIVERED": "已交付",
    "status.ACCEPTED": "已验收",
    "status.CLOSED": "已关闭"
  },
  "en-US": {
    "menu.dashboard": "Dashboard",
    "menu.customers": "Customers",
    "menu.contracts": "Contracts",
    "menu.projects": "Projects",
    "menu.invoices": "Invoices",
    "menu.payments": "Payments",
    "menu.statistics": "Statistics",
    "menu.messages": "Messages",
    "menu.announcements": "Announcements",
    "menu.admin": "Admin",
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
    "status.CANCELLED": "Cancelled",
    "status.PLANNED_PROJECT": "Planned",
    "status.IN_PROGRESS": "In Progress",
    "status.SUSPENDED": "Suspended",
    "status.DELIVERED": "Delivered",
    "status.ACCEPTED": "Accepted",
    "status.CLOSED": "Closed"
  }
};

export function getT(locale: Locale = "zh-CN") {
  return (key: string): string => messages[locale]?.[key] ?? messages["zh-CN"][key] ?? key;
}

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en-US"];
export const DEFAULT_LOCALE: Locale = "zh-CN";

// 客户端：使用 zustand 持久化 locale
// 这里只是一个简单 hook：useT 读 zustand store
