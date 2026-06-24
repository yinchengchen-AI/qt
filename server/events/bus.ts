// 领域事件总线：emit 时直接传 receivers 与模板 payload，写入 Message 表
// 状态机迁移时在事务内 emit → 原子性
import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { dispatchExternalChannels } from "./dispatcher";

export type DomainEventType =
  | "CONTRACT_AUTO_EXECUTED"
  | "CONTRACT_AUTO_COMPLETED"
  | "CONTRACT_AUTO_EXPIRED"
  | "CONTRACT_PENDING_REVIEW"
  | "CONTRACT_EXPIRING"
  | "CONTRACT_APPROVED"
  | "CONTRACT_REJECTED"
  | "INVOICE_OVERDUE_PAYMENT"
  | "PAYMENT_RECEIVED"
  | "PROJECT_DUE"
  | "CUSTOMER_INACTIVE"
  | "CUSTOMER_STATUS_SUGGEST"
  | "WORKFLOW_TASK_ASSIGNED"
  | "WORKFLOW_REVIEW_REQUESTED"

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
  await prisma.message.createMany({ data });
  // 触发外部通道（fire-and-forget；事务回滚风险可接受）
  const resolved = data.map((d, i) => ({ ...d, link: messages[i]?.link } as unknown as { receiverUserId: string; title: string; content: string; link?: Record<string, unknown> }));
  void dispatchExternalChannels(ev, resolved).catch((e) => console.warn("[bus] dispatch failed:", e));
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
    case "CONTRACT_PENDING_REVIEW":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 等待您审批`,
        content: `签订日期 ${formatDate(p.signDate)}，请尽快审核。`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CONTRACT_EXPIRING":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 将于 ${p.daysLeft} 天后到期`,
        content: `到期日：${formatDate(p.endDate)}`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CONTRACT_APPROVED":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 已审批通过`,
        content: `生效日期：${formatDate(p.startDate)}`,
        link: { kind: "contract", id: p.contractId }
      };
    case "CONTRACT_REJECTED":
      return {
        receiverUserId: uid,
        title: `合同 ${p.contractNo} 已被驳回`,
        content: p.comment ? `意见：${p.comment}` : "请修改后重新提交。",
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
    case "PROJECT_DUE":
      return {
        receiverUserId: uid,
        title: `项目 ${p.projectNo} 将于 ${p.daysLeft} 天后计划完成`,
        content: `合同：${p.contractNo}`,
        link: { kind: "project", id: p.projectId }
      };
    case "CUSTOMER_INACTIVE":
      return {
        receiverUserId: uid,
        title: `客户 ${p.customerName} 已 ${p.daysInactive} 天未跟进`,
        content: `请尽快联系客户。`,
        link: { kind: "customer", id: p.customerId }
      };
    case "CUSTOMER_STATUS_SUGGEST":
      return {
        receiverUserId: uid,
        title: `建议将客户 ${p.customerName} 状态变更为 ${p.suggestedStatusLabel ?? p.suggestedStatus}`,
        content: `原因: ${p.reason ?? "-"}\n点击查看详情并确认。`,
        link: { kind: "customer", id: p.customerId, suggest: p.suggestedStatus }
      };
    case "WORKFLOW_TASK_ASSIGNED":
      return {
        receiverUserId: uid,
        title: `任务「${p.taskName}」已指派给您`,
        content: `所属项目: ${p.projectNo ?? "-"}\n预估 ${p.estimateDays ?? "-"} 天`,
        link: { kind: "project", id: p.projectId }
      };
    case "WORKFLOW_REVIEW_REQUESTED":
      return {
        receiverUserId: uid,
        title: `报告「${p.taskName}」等待您校核/审核`,
        content: `项目: ${p.projectNo ?? "-"}\n提交人: ${p.submittedByName ?? "-"}`,
        link: { kind: "project", id: p.projectId }
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
