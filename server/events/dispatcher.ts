// 事件 dispatcher：emit 到 inbox + 其他通道（fire-and-forget）
// 设计：inbox 写 Message 在事务内（已有）；email / wechat 在事务外异步（失败不抛，仅 log）
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHANNEL_HANDLERS, type ChannelPayload } from "./channels";
import { NOTIFY_CONFIG, isChannelEnabled, type NotifyChannel } from "@/lib/notify-config";

type ResolvedMessage = {
  receiverUserId: string;
  title: string;
  content: string;
  link?: Record<string, unknown>;
};

type DomainEvent = import("./bus").DomainEvent;

const TYPE_TO_TEMPLATE: Record<string, (p: Record<string, unknown>, uid: string) => ResolvedMessage> = {
  CONTRACT_PENDING_REVIEW: (p) => ({
    receiverUserId: "",
    title: `合同 ${p.contractNo} 等待您审批`,
    content: `签订日期 ${formatDate(p.signDate)}，请尽快审核。`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_EXPIRING: (p) => ({
    receiverUserId: "",
    title: `合同 ${p.contractNo} 将于 ${p.daysLeft} 天后到期`,
    content: `到期日：${formatDate(p.endDate)}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_APPROVED: (p) => ({
    receiverUserId: "",
    title: `合同 ${p.contractNo} 已审批通过`,
    content: `生效日期：${formatDate(p.startDate)}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_REJECTED: (p) => ({
    receiverUserId: "",
    title: `合同 ${p.contractNo} 已被驳回`,
    content: p.comment ? `意见：${p.comment}` : "请修改后重新提交。",
    link: { kind: "contract", id: p.contractId }
  }),
  INVOICE_OVERDUE_PAYMENT: (p) => ({
    receiverUserId: "",
    title: `发票 ${p.invoiceNo} 已开票 ${p.daysOverdue} 天，剩余未回款 ¥${p.remaining}`,
    content: `客户：${p.customerName}`,
    link: { kind: "invoice", id: p.invoiceId }
  }),
  PAYMENT_RECEIVED: (p) => ({
    receiverUserId: "",
    title: `客户 ${p.customerName} 回款 ¥${p.amount} 已确认`,
    content: `回款单号：${p.paymentNo}`,
    link: { kind: "payment", id: p.paymentId }
  }),
  PROJECT_DUE: (p) => ({
    receiverUserId: "",
    title: `项目 ${p.projectNo} 将于 ${p.daysLeft} 天后计划完成`,
    content: `合同：${p.contractNo}`,
    link: { kind: "project", id: p.projectId }
  }),
  CUSTOMER_INACTIVE: (p) => ({
    receiverUserId: "",
    title: `客户 ${p.customerName} 已 ${p.daysInactive} 天未跟进`,
    content: `请尽快联系客户。`,
    link: { kind: "customer", id: p.customerId }
  })
};

function formatDate(d: unknown): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d instanceof Date ? d : null;
  if (!date || isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

const TX_CLIENT_KEYS = new Set([
  "$connect", "$disconnect", "$on", "$transaction", "$use", "$extends"
]);

function isTransactionClient(x: unknown): x is Prisma.TransactionClient {
  return !!x && typeof x === "object" && !TX_CLIENT_KEYS.has("$connect" in x ? "$connect" : "");
}

/** 异步发送非 inbox 通道；不抛错，仅 log */
export async function dispatchExternalChannels(event: DomainEvent, messages: ResolvedMessage[]): Promise<void> {
  const channels = NOTIFY_CONFIG.channelsByType[event.type] ?? ["inbox"];
  const externalChannels = channels.filter((c) => c !== "inbox") as Exclude<NotifyChannel, "inbox">[];
  if (externalChannels.length === 0) return;

  // 拉 receiver user 邮箱
  const userIds = messages.map((m) => m.receiverUserId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true, name: true, email: true }
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  for (const m of messages) {
    const u = userMap.get(m.receiverUserId);
    if (!u) continue;
    const payload: ChannelPayload = {
      type: event.type,
      title: m.title,
      content: m.content,
      link: (m.link as { kind: string; id: string }) ?? null,
      to: { userId: u.id, email: u.email, name: u.name }
    };
    for (const ch of externalChannels) {
      if (!isChannelEnabled(ch)) continue;
      const handler = CHANNEL_HANDLERS[ch];
      if (!handler) continue;
      // fire-and-forget
      handler(payload).then((r) => {
        if (!r.ok) console.warn(`[notify] ${ch} failed:`, r.error, `type=${event.type} user=${u.id}`);
      }).catch((e) => {
        console.warn(`[notify] ${ch} crashed:`, e, `type=${event.type} user=${u.id}`);
      });
    }
  }
}

// 重新导出 builder（bus.ts 之前用过的相同逻辑）
export { TYPE_TO_TEMPLATE, formatDate };
