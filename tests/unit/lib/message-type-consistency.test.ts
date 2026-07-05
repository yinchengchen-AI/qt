// MESSAGE_TYPE 与 Prisma MessageType enum 一致性测试
//
// 背景:server/events/bus.ts 的 DomainEventType 从 types/enums.ts 的 MESSAGE_TYPE 派生;
//       Prisma schema 又有自己的 MessageType enum。三者必须保持一一对应,否则:
//         - 加新事件到 MESSAGE_TYPE 但忘改 Prisma enum → bus.emit 写入失败
//         - 加新事件到 Prisma enum 但忘改 MESSAGE_TYPE → TS 编译期通过,运行时没事件
//
// 由于已下线的事件类型 (CUSTOMER_STATUS_*) 会保留在 PG enum 中以兼容历史消息,
// 应用层 MESSAGE_TYPE 应是 DB enum 的子集;本测试同时校验没有未知的新类型遗漏。
import { describe, it, expect } from "vitest";
import { MESSAGE_TYPE } from "@/types/enums";
import { prisma } from "@/lib/prisma";

// v0.5.0 起客户状态机下线,以下类型不再 emit,但保留在 PG enum 供历史消息可读
const DEPRECATED_MESSAGE_TYPES: string[] = [
  "CUSTOMER_STATUS_SUGGEST",
  "CUSTOMER_STATUS_AUTO_APPLIED",
  "CUSTOMER_STATUS_AUTO_REVERTED",
];

describe("MESSAGE_TYPE / Prisma MessageType 一致性", () => {
  it("MESSAGE_TYPE 数组是 Prisma MessageType enum 的子集", async () => {
    // 用一个未保存的 raw query 拿到 PG enum 的所有合法 label
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'MessageType')
    `;
    const dbLabels = rows.map((r) => r.enumlabel);
    const appValues = [...MESSAGE_TYPE];
    for (const v of appValues) {
      expect(dbLabels).toContain(v);
    }
  });

  it("DB enum 中超出 MESSAGE_TYPE 的部分只能是已知的下线类型", async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'MessageType')
    `;
    const dbLabels = rows.map((r) => r.enumlabel);
    const appSet = new Set<string>(MESSAGE_TYPE);
    const deprecatedSet = new Set<string>(DEPRECATED_MESSAGE_TYPES);
    const extra = dbLabels.filter((l) => !appSet.has(l));
    for (const l of extra) {
      expect(deprecatedSet.has(l)).toBe(true);
    }
  });

  it("MESSAGE_TYPE 不应有重复", () => {
    const set = new Set(MESSAGE_TYPE);
    expect(set.size).toBe(MESSAGE_TYPE.length);
  });

  it("每个 MESSAGE_TYPE 字符串都能落库 (smoke test:createMany + deleteMany)", async () => {
    // 真正尝试用每个 type 写一行,失败的话会抛 PG enum 错误
    // 写完立刻删,不留垃圾
    const receiverId = (await prisma.user.findFirst({ where: { isSystem: true }, select: { id: true } }))?.id;
    if (!receiverId) {
      // 没 system 用户就跳过(没有 system 种子数据)
      return;
    }
    try {
      for (const t of MESSAGE_TYPE) {
        const m = await prisma.message.create({
          data: { receiverUserId: receiverId, type: t as never, title: "consistency-test", content: "x" }
        });
        await prisma.message.delete({ where: { id: m.id } });
      }
    } catch (e) {
      throw new Error(`MESSAGE_TYPE 与 Prisma enum 不一致: ${e instanceof Error ? e.message : e}`);
    }
  });
});
