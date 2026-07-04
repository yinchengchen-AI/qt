// lib/status-machine.ts 竞态保护单元测试
// 覆盖: runTransitionInTx 在 UPDATE 的 WHERE 中带源状态,
//       并发导致 P2025 时映射为 SKIPPED(自动迁移) 或 mismatch 错误(手动迁移).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { runTransitionInTx, SkipTransition } from "@/lib/status-machine";
import { ERROR_CODES } from "@/types/errors";
import type { Prisma as PrismaNS } from "@prisma/client";

type FakePayment = { id: string; status: string };

function makeMockTx(updateResult: unknown = {}) {
  const updateSpy = vi.fn(async () => updateResult);
  return {
    payment: {
      update: updateSpy,
    },
    contract: { update: vi.fn(async () => ({})) },
    customer: { update: vi.fn(async () => ({})) },
    invoice: { update: vi.fn(async () => ({})) },
  } as unknown as PrismaNS.TransactionClient;
}

function baseInput(): Parameters<typeof runTransitionInTx<FakePayment>>[1] {
  return {
    entity: "Payment",
    loadInTx: async () => ({ id: "pay-1", status: "PLANNED" }),
    from: ["PLANNED"],
    to: "CONFIRMED",
    audit: () => ({ actorId: "u-1", action: "PAYMENT_CONFIRM", before: {}, after: {} }),
  };
}

// audit / emit 依赖真实 prisma, 这里 mock 掉, 避免连 DB
vi.mock("@/server/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/server/events/bus", () => ({ emit: vi.fn(async () => {}) }));

describe("runTransitionInTx - 并发覆盖保护", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UPDATE WHERE 必须包含源状态 in [...from]", async () => {
    const tx = makeMockTx();
    await runTransitionInTx(tx, {
      ...baseInput(),
      from: ["PLANNED", "PENDING"],
      to: "CONFIRMED",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = (tx as any).payment.update.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "pay-1", status: { in: ["PLANNED", "PENDING"] } });
  });

  it("UPDATE 成功时返回 DONE", async () => {
    const tx = makeMockTx();
    const r = await runTransitionInTx(tx, baseInput());
    expect(r.result).toBe("DONE");
  });

  it("UPDATE 命中 0 行(P2025) + silentSkip=true → 返回 SKIPPED", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError("No record found", {
      code: "P2025",
      clientVersion: "7.8.0",
    });
    const tx = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).payment.update.mockRejectedValueOnce(p2025);

    const r = await runTransitionInTx(tx, { ...baseInput(), silentSkip: true });
    expect(r.result).toBe("SKIPPED");
  });

  it("UPDATE 命中 0 行(P2025) + silentSkip=false → 抛 ENTITY_IMMUTABLE", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError("No record found", {
      code: "P2025",
      clientVersion: "7.8.0",
    });
    const tx = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).payment.update.mockRejectedValueOnce(p2025);

    await expect(runTransitionInTx(tx, baseInput())).rejects.toThrow("当前状态 PLANNED 不可迁移到 CONFIRMED");
  });

  it("UPDATE 命中 0 行(P2025) 时优先使用自定义 mismatchError", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError("No record found", {
      code: "P2025",
      clientVersion: "7.8.0",
    });
    const tx = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).payment.update.mockRejectedValueOnce(p2025);

    await expect(
      runTransitionInTx(tx, {
        ...baseInput(),
        mismatchError: { code: ERROR_CODES.VALIDATION_FAILED, status: 422, message: () => "自定义错误" },
      })
    ).rejects.toMatchObject({ status: 422, message: "自定义错误" });
  });

  it("非 P2025 错误继续上抛", async () => {
    const other = new Error("network down");
    const tx = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).payment.update.mockRejectedValueOnce(other);

    await expect(runTransitionInTx(tx, baseInput())).rejects.toThrow("network down");
  });

  it("源状态不匹配时不会走到 UPDATE(由 loadInTx + from 检查拦截)", async () => {
    const tx = makeMockTx();
    const r = await runTransitionInTx(tx, {
      ...baseInput(),
      loadInTx: async () => ({ id: "pay-1", status: "CANCELLED" }),
      silentSkip: true,
    });
    expect(r.result).toBe("SKIPPED");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).payment.update).not.toHaveBeenCalled();
  });

  it("precondition 抛 SkipTransition 时返回 SKIPPED 且不做 UPDATE", async () => {
    const tx = makeMockTx();
    const r = await runTransitionInTx(tx, {
      ...baseInput(),
      precondition: () => {
        throw new SkipTransition();
      },
      silentSkip: true,
    });
    expect(r.result).toBe("SKIPPED");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).payment.update).not.toHaveBeenCalled();
  });
});
