// 领域事件总线：emit 时直接传 receivers 与模板 payload，写入 Message 表
// 状态机迁移时在事务内 emit → 原子性
//
// 事件类型派生自 types/enums.ts 的 MESSAGE_TYPE,确保:
//   - 编译期 DomainEventType 与常量数组一致
//   - DB 层(prisma enum MessageType)与这里一致
//   - 加新事件时只改 MESSAGE_TYPE + prisma enum + builder-registry
//
// v0.22.0 改动：
//   - 渲染从 inline switch 拆到 server/events/builder-registry.ts
//   - emit 写入前过滤用户已退订的 type（MessagePreference.enabled=false）
//   - 写入成功后非事务路径立即 broadcastNew (message:new 事件) + broadcastKick 兜底
import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { MESSAGE_TYPE } from "@/types/enums";
import { broadcastKick, broadcastNew, queueKickKick } from "@/server/notifications/hub";
import { getDisabledMap } from "@/server/services/message-preference";
import { getBuilder } from "@/server/events/builder-registry";

export type DomainEventType = (typeof MESSAGE_TYPE)[number];

export type DomainEvent = {
  type: DomainEventType;
  payload: Record<string, unknown>;
  /** 接收人 userId 列表；调用方已确定（service 层基于 ownerUserId / roleCode） */
  receivers: string[];
  /**
   * 业务实体键(`{type}:{link.id}`),用于 (entityKey, receiverUserId) 行级去重。
   * 调用方应显式提供;不传时 emit 不写 entityKey(允许 deprecated / 无 link 消息走宽松去重)。
   */
  entityKey?: string;
};

type TxOrClient = Prisma.TransactionClient | PrismaClient;

export async function emit(prisma: TxOrClient, ev: DomainEvent): Promise<number> {
  if (!ev.receivers || ev.receivers.length === 0) return 0;

  // v0.22.0: 过滤退订用户
  const disabledMap = await getDisabledMap(ev.receivers, prisma);
  const effectiveReceivers = ev.receivers.filter((uid) => {
    const disabled = disabledMap.get(uid);
    return !disabled || !disabled.has(ev.type);
  });
  if (effectiveReceivers.length === 0) return 0;

  const builder = getBuilder(ev.type);
  const messages = effectiveReceivers.map((uid) => {
    const r = builder(ev.payload);
    return {
      receiverUserId: uid,
      title: r.title,
      content: r.content,
      link: r.link
    };
  });

  const data = messages.map((m) => ({
    receiverUserId: m.receiverUserId,
    type: ev.type as Prisma.MessageCreateManyInput["type"],
    title: m.title,
    content: m.content,
    link: (m.link ?? PrismaNS.JsonNull) as Prisma.InputJsonValue,
    entityKey: ev.entityKey ?? null
  }));
  await prisma.message.createMany({ data, skipDuplicates: true });

  // v0.22.0: 拉回真实写入的 (id, type, title, content, link, createdAt, receiverUserId) 用于推送
  // 简化: 一次性 createMany 后再 findMany 拿 (entityKey, receiverUserId) → row
  // 性能: 仅当 receivers ≤ 200 走这条路, 超过走纯 kick 兜底
  const isTx = typeof (prisma as Prisma.TransactionClient).$transaction === "function";
  if (effectiveReceivers.length <= 200) {
    const rows = await (prisma as PrismaClient).message.findMany({
      where: {
        type: ev.type as Prisma.MessageWhereInput["type"],
        receiverUserId: { in: effectiveReceivers },
        createdAt: { gte: new Date(Date.now() - 5000) } // 5s 窗口
      },
      orderBy: { createdAt: "desc" },
      take: effectiveReceivers.length,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        createdAt: true,
        readAt: true,
        receiverUserId: true
      }
    });
    if (!isTx) {
      for (const row of rows) broadcastNew(row);
    } else {
      queueKickKick(effectiveReceivers);
    }
  } else {
    if (!isTx) {
      for (const uid of effectiveReceivers) broadcastKick(uid);
    } else {
      queueKickKick(effectiveReceivers);
    }
  }

  return messages.length;
}

/** 找出全部 *真人* ADMIN 的 userId;排除 isSystem 占位；用于"通用通知"接收人 */
export async function listAdminUserIds(prisma: TxOrClient): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", isSystem: false, role: { code: "ADMIN" } },
    select: { id: true }
  });
  return users.map((u) => u.id);
}
