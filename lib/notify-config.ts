// 通知配置：通道开关 + 凭据
// 读取顺序：env > 默认值
// 仅 ADMIN 可以在 .env 维护；运行时不可改（P3 阶段）

export type NotifyChannel = "inbox" | "email" | "wechatWork";

export const NOTIFY_CONFIG = {
  // 全局开关
  enabled: {
    inbox: true,            // 站内信永远开
    email: process.env.NOTIFY_EMAIL_ENABLED === "true",
    wechatWork: process.env.NOTIFY_WECHAT_WORK_ENABLED === "true"
  },
  email: {
    host: process.env.SMTP_HOST ?? "smtp.example.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== "false", // default true
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "no-reply@qt.com"
  },
  wechatWork: {
    webhookUrl: process.env.WECHAT_WORK_WEBHOOK_URL ?? ""
  },
  // 每个事件类型走哪些通道
  channelsByType: {
    CONTRACT_PENDING_REVIEW: ["inbox", "email"] as NotifyChannel[],
    CONTRACT_APPROVED: ["inbox"] as NotifyChannel[],
    CONTRACT_REJECTED: ["inbox", "email"] as NotifyChannel[],
    CONTRACT_EXPIRING: ["inbox"] as NotifyChannel[],
    INVOICE_OVERDUE_PAYMENT: ["inbox", "email", "wechatWork"] as NotifyChannel[],
    PAYMENT_RECEIVED: ["inbox"] as NotifyChannel[],
    PROJECT_DUE: ["inbox"] as NotifyChannel[],
    CUSTOMER_INACTIVE: ["inbox"] as NotifyChannel[],
    WORKFLOW_TASK_ASSIGNED: ["inbox", "email"] as NotifyChannel[],
    WORKFLOW_REVIEW_REQUESTED: ["inbox", "email"] as NotifyChannel[],
  } as Record<string, NotifyChannel[]>
};

export function isChannelEnabled(channel: NotifyChannel): boolean {
  return NOTIFY_CONFIG.enabled[channel] === true;
}
