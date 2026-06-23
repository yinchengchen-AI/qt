// 事件 dispatcher：把 bus.ts:emit 已渲染好的消息分发到外部通道（fire-and-forget）
//
// 设计边界：inbox 渲染（title / content / link 拼装）的"单一事实源"在
//   server/events/bus.ts 的 buildMessage() 里。
// dispatcher 不再做模板渲染，只负责"已经渲染好的消息" + 用户联系方式 → 通道 handler。
// (P0-3: 早期 dispatcher 自带一份 TYPE_TO_TEMPLATE 模板, 与 bus.buildMessage 漂移且无人调用, 已删除。)
//
// 流程：emit 写 inbox（事务内） → 事务提交后由 dispatchExternalChannels 异步派发邮件/企微；
//   外部通道失败不抛错，但会写入 OperationLog（status=FAILURE），便于排查与告警。
//
// (Prisma types imported lazily in the functions that need them)
import { prisma } from "@/lib/prisma";
import { CHANNEL_HANDLERS, type ChannelPayload } from "./channels";
import { NOTIFY_CONFIG, isChannelEnabled, type NotifyChannel } from "@/lib/notify-config";
import { audit } from "@/server/audit";
import { SYSTEM_USER_ID } from "@/lib/system";

type ResolvedMessage = {
  receiverUserId: string;
  title: string;
  content: string;
  link?: Record<string, unknown>;
};

type DomainEvent = import("./bus").DomainEvent;

async function logNotifyFailure(
  eventType: string,
  channel: string,
  userId: string,
  errorMessage: string
) {
  try {
    await audit(prisma, {
      actorId: SYSTEM_USER_ID,
      action: "NOTIFY_CHANNEL_FAILURE",
      entity: "NotifyChannel",
      entityId: `${eventType}/${channel}/${userId}`,
      status: "FAILURE",
      errorMessage
    });
  } catch (e) {
    console.warn("[notify] audit failure log failed:", e);
  }
}

/** 异步发送非 inbox 通道；不抛错，失败写入 OperationLog */
export async function dispatchExternalChannels(event: DomainEvent, messages: ResolvedMessage[]): Promise<void> {
  const channels = NOTIFY_CONFIG.channelsByType[event.type] ?? ["inbox"];
  const externalChannels = channels.filter((c) => c !== "inbox") as Exclude<NotifyChannel, "inbox">[];
  if (externalChannels.length === 0) return;

  // 拉 receiver user 邮箱；排除系统占位与已禁用/软删用户
  const userIds = messages.map((m) => m.receiverUserId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null, status: "ACTIVE", isSystem: false },
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
      handler(payload)
        .then((r) => {
          if (!r.ok) {
            console.warn(`[notify] ${ch} failed:`, r.error, `type=${event.type} user=${u.id}`);
            void logNotifyFailure(event.type, ch, u.id, r.error ?? "unknown");
          }
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[notify] ${ch} crashed:`, e, `type=${event.type} user=${u.id}`);
          void logNotifyFailure(event.type, ch, u.id, msg);
        });
    }
  }
}
