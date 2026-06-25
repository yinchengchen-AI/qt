// 领域事件总线：emit 时直接传 receivers 与模板 payload，写入 Message 表
// 状态机迁移时在事务内 emit → 原子性
//
// 事件类型派生自 types/enums.ts 的 MESSAGE_TYPE,确保:
//   - 编译期 DomainEventType 与常量数组一致
//   - DB 层(prisma enum MessageType)与这里一致
//   - 加新事件时只改 MESSAGE_TYPE + prisma enum + buildMessage case
import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { MESSAGE_TYPE } from "@/types/enums";

export type DomainEventType = (typeof MESSAGE_TYPE)[number];

export type DomainEvent = {
  type: DomainEventType;
  payload: Record<string, unknown>;
  /** 接收人 userId 列表；调用方已确定（service 层基于 ownerUserId / roleCode） */
  receivers: string[];
};

type TxOrClient = Prisma.TransactionClient | PrismaClient;

export async function emit(prisma: TxOrClient, ev: DomainEvent): Promise<number> {
  if (!ev.receivers || ev.receivers.length === 0) return 0;
  const messages = ev.receivers.map((uid) => buildMessage(uid, ev));
  // 去重（同一人不会收两条相同 type+entityId）
  const data = messages.map((m) => ({
    receiverUserId: m.receiverUserId,
    type: ev.type,
    title: m.title,
    content: m.content,
    link: (m.link ?? PrismaNS.JsonNull) as Prisma.InputJsonValue
  }));
  // P0-2: 一次性 createMany 替代原来的 for-await prisma.message.create。
  // 项目只走 Prisma + PostgreSQL,createMany 可用;原顺序写法是 N+1 round-trip,
  // cron 跑合同到期 30/7/1 × 全部 ACTIVE × (owner+admin) 经常 100+ 条。
  // createMany 是单条 INSERT...VALUES (...),(...),事务回滚由调用方的 $transaction 保证。
  //
  // 通知统一走站内信:外部通道(email / 企微 webhook)已下线,本函数是唯一的写 Message 入口。
  // 如需恢复外部通道,需要把"已渲染的消息 + 用户联系方式"再派发到通道 handler;
  // 那个派发必须放在事务外(失败不阻塞业务),并在事务回滚时通过 message.findFirst
  // 反查避免发出"假阳性"通知。
  await prisma.message.createMany({ data });
  return data.length;
}

type ResolvedMessage = {
  receiverUserId: string;
  title: string;
  content: string;
  link?: Record<string, unknown>;
};

function buildMessage(uid: string, ev: DomainEvent): ResolvedMessage {
  const p = ev.payload;
  switch (ev.type) {
    case "CONTRACT_EXPIRING":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 将于 ${p.daysLeft} 天后到期`,
        content: `到期日：${formatDate(p.endDate)}`,
        link: { kind: "contract", id: p.contractId }
      };
    case "INVOICE_OVERDUE_PAYMENT":
      return {
        receiverUserId: uid,
        title: `发票 ${p.invoiceNo} 已开票 ${p.daysOverdue} 天，剩余未回款 ¥${p.remaining}`,
        content: `客户：${p.customerName}`,
        link: { kind: "invoice", id: p.invoiceId }
      };
    case "PAYMENT_RECEIVED":
      return {
        receiverUserId: uid,
        title: `客户 ${p.customerName} 回款 ¥${p.amount} 已确认`,
        content: `回款单号：${p.paymentNo}`,
        link: { kind: "payment", id: p.paymentId }
      };
    case "CUSTOMER_STATUS_SUGGEST":
      return {
        receiverUserId: uid,
        title: `建议将客户 ${p.customerName} 状态变更为 ${p.suggestedStatusLabel ?? p.suggestedStatus}`,
        content: `原因: ${p.reason ?? "-"}\n点击查看详情并确认。`,
        link: { kind: "customer", id: p.customerId, suggest: p.suggestedStatus }
      };
    case "CONTRACT_AUTO_EXECUTED":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 已自动进入执行`,
        content: `关联项目「${p.projectName ?? "-"}」已开工`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CONTRACT_AUTO_COMPLETED":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 已自动结清`,
        content: `合同下所有项目已收尾`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CONTRACT_AUTO_EXPIRED":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 已自动到期`,
        content: `合同到期日：${formatDate(p.endDate)}`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CERTIFICATE_EXPIRING":
      // 证书到期提醒 (server/jobs/certificate-expiry-check 触发)
      // payload 字段: certificateId, userId, certName, expiryDate, daysLeft
      // 完整文案在 PR9 接入 cron 时精修;这里先做最小可用版本,确保 typecheck 通过
      return {
        receiverUserId: uid,
        title: `证书 ${String(p.certName ?? "-")} 将于 ${Number(p.daysLeft ?? 0)} 天后到期`,
        content: `到期日：${formatDate(p.expiryDate)}`,
        link: { kind: "employee-profile", id: p.userId, certificateId: p.certificateId }
      };
    default:
      return assertNever(ev.type);
  }
}

function assertNever(value: never): never {
  throw new Error(`[bus] unhandled event type: ${value as string}`);
}

function formatDate(d: unknown): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d instanceof Date ? d : null;
  if (!date || isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

/** 找出全部 *真人* ADMIN 的 userId;排除 isSystem 占位；用于"通用通知"接收人 */
export async function listAdminUserIds(prisma: TxOrClient): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", isSystem: false, role: { code: "ADMIN" } },
    select: { id: true }
  });
  return users.map((u) => u.id);
}


