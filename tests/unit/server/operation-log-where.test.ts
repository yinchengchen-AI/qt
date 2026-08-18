// buildOperationLogWhere 纯函数单测：查询参数 -> Prisma where 的映射
import { describe, it, expect } from "vitest";
import { buildOperationLogWhere } from "@/server/services/operation-log";

describe("buildOperationLogWhere", () => {
  it("空参数 -> 空 where", () => {
    expect(buildOperationLogWhere({})).toEqual({});
  });

  it("等值过滤:entity / action / actorId / entityId / status", () => {
    expect(
      buildOperationLogWhere({
        entity: "Contract",
        action: "CONTRACT_SUBMIT",
        actorId: "u1",
        entityId: "c1",
        status: "FAILURE",
      }),
    ).toEqual({
      entity: "Contract",
      action: "CONTRACT_SUBMIT",
      actorId: "u1",
      entityId: "c1",
      status: "FAILURE",
    });
  });

  it("ip 走 contains(支持前缀匹配)", () => {
    expect(buildOperationLogWhere({ ip: "10.0." })).toEqual({
      ip: { contains: "10.0." },
    });
  });

  it("keyword -> 对象ID/路径/请求ID/失败原因 四路 insensitive OR", () => {
    expect(buildOperationLogWhere({ keyword: "abc" })).toEqual({
      OR: [
        { entityId: { contains: "abc", mode: "insensitive" } },
        { path: { contains: "abc", mode: "insensitive" } },
        { requestId: { contains: "abc", mode: "insensitive" } },
        { errorMessage: { contains: "abc", mode: "insensitive" } },
      ],
    });
  });

  it("时间范围:from/to -> at gte/lte; 单边也生效", () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-08-19T23:59:59Z");
    expect(buildOperationLogWhere({ from, to })).toEqual({
      at: { gte: from, lte: to },
    });
    expect(buildOperationLogWhere({ from })).toEqual({ at: { gte: from } });
    expect(buildOperationLogWhere({ to })).toEqual({ at: { lte: to } });
  });

  it("组合过滤:keyword 与普通等值条件并存", () => {
    const w = buildOperationLogWhere({ entity: "Invoice", keyword: "INV" });
    expect(w.entity).toBe("Invoice");
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR).toHaveLength(4);
  });
});
