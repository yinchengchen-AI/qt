// 状态机抽象单元测试 (lib/status-machine.ts)
//
// 覆盖: 状态匹配 / 静默跳过 / 抛错 / 事务嵌套 / P2034 重试 / 实体 dispatch /
//       reviewLog / event / audit / mismatchError
//
// 模板: tests/unit/server/customer-status.test.ts
// 用 vi.mock("@/lib/prisma", ...) + vi.hoisted 模式, 不依赖真实 DB.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ERROR_CODES } from "@/types/errors";

// === Hoisted mock 状态 ===
const mockState = vi.hoisted(() => {
  return {
    contract: { id: "c-1", status: "DRAFT", contractNo: "QT-HT-2026-0001", ownerUserId: "u-1" } as Record<string, unknown> | null,
    updateCalls: [] as Array<{ entity: string; id: string; data: Record<string, unknown> }>,
    reviewLogCalls: [] as Array<{ contractId: string; action: string; comment?: string | null; reviewerId: string }>,
    auditCalls: [] as Array<{
      actorId: string;
      action: string;
      entity: string;
      entityId: string;
      before: unknown;
      after: unknown;
    }>,
    emitCalls: [] as Array<{ type: string; payload: unknown; receivers: string[] }>,
    p2034Count: 0,
    txnCalls: 0,
  };
});

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, _opts?: unknown) => {
        mockState.txnCalls++;
        if (mockState.p2034Count > 0) {
          mockState.p2034Count--;
          throw new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "7" });
        }
        const tx = {
          contract: {
            findFirst: vi.fn(async () => mockState.contract),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              mockState.updateCalls.push({ entity: "Contract", id: where.id, data });
              return { ...mockState.contract, ...data, id: where.id };
            }),
          },
          invoice: {
            findFirst: vi.fn(async () => ({ id: "i-1", status: "DRAFT" })),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              mockState.updateCalls.push({ entity: "Invoice", id: where.id, data });
              return { id: where.id, ...data };
            }),
          },
          payment: {
            findFirst: vi.fn(async () => ({ id: "p-1", status: "PLANNED" })),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              mockState.updateCalls.push({ entity: "Payment", id: where.id, data });
              return { id: where.id, ...data };
            }),
          },
          contractReviewLog: {
            create: vi.fn(async ({ data }: { data: { contractId: string; action: string; comment?: string | null; reviewerId: string } }) => {
              mockState.reviewLogCalls.push(data);
              return data;
            }),
          },
        } as unknown as Prisma.TransactionClient;
        return fn(tx);
      }),
    },
  };
});

vi.mock("@/server/audit", () => ({
  audit: vi.fn(
    async (
      _tx: unknown,
      input: {
        actorId: string;
        action: string;
        entity: string;
        entityId: string;
        before?: unknown;
        after?: unknown;
      }
    ) => {
      mockState.auditCalls.push({
        actorId: input.actorId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: input.before,
        after: input.after,
      });
    }
  ),
}));

vi.mock("@/server/events/bus", () => ({
  emit: vi.fn(async (_tx: unknown, ev: { type: string; payload: unknown; receivers: string[] }) => {
    mockState.emitCalls.push(ev);
    return 0;
  }),
  listAdminUserIds: vi.fn(async () => ["u-admin-1"]),
}));

import { prisma } from "@/lib/prisma";
import { runTransitionInTx, runTransition, SkipTransition } from "@/lib/status-machine";
import { SYSTEM_USER_ID } from "@/lib/system";

beforeEach(() => {
  mockState.contract = { id: "c-1", status: "DRAFT", contractNo: "QT-HT-2026-0001", ownerUserId: "u-1" };
  mockState.updateCalls = [];
  mockState.reviewLogCalls = [];
  mockState.auditCalls = [];
  mockState.emitCalls = [];
  mockState.p2034Count = 0;
  mockState.txnCalls = 0;
});

describe("runTransitionInTx - 状态匹配与事务", () => {
  it("状态匹配 → { result: DONE }, audit 写 1 次, update 写 1 次", async () => {
    const r = await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        audit: () => ({
          actorId: SYSTEM_USER_ID,
          action: "TEST_PUBLISH",
          before: { status: "DRAFT" },
          after: { status: "ACTIVE" },
        }),
      })
    );
    expect(r.result).toBe("DONE");
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0]!.data.status).toBe("ACTIVE");
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.auditCalls[0]!.action).toBe("TEST_PUBLISH");
  });

  it("状态不匹配 + silentSkip=true → SKIPPED, 无副作用", async () => {
    mockState.contract = { id: "c-1", status: "CLOSED", contractNo: "X", ownerUserId: "u-1" };
    const r = await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        silentSkip: true,
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    );
    expect(r.result).toBe("SKIPPED");
    expect(mockState.updateCalls).toHaveLength(0);
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("状态不匹配 + silentSkip=false → 抛 ENTITY_IMMUTABLE 403", async () => {
    mockState.contract = { id: "c-1", status: "CLOSED", contractNo: "X", ownerUserId: "u-1" };
    await expect(
      prisma.$transaction(async (tx) =>
        runTransitionInTx(tx, {
          entity: "Contract",
          loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
          from: ["DRAFT"],
          to: "ACTIVE",
          audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        })
      )
    ).rejects.toMatchObject({ errorCode: "ENTITY_IMMUTABLE", status: 403 });
  });

  it("loadInTx 返回 null + silentSkip=true → SKIPPED", async () => {
    mockState.contract = null;
    const r = await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        silentSkip: true,
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    );
    expect(r.result).toBe("SKIPPED");
  });

  it("loadInTx 返回 null + silentSkip=false → 抛 NOT_FOUND 404", async () => {
    mockState.contract = null;
    await expect(
      prisma.$transaction(async (tx) =>
        runTransitionInTx(tx, {
          entity: "Contract",
          loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
          from: ["DRAFT"],
          to: "ACTIVE",
          audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        })
      )
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", status: 404 });
  });
});

describe("runTransitionInTx - precondition", () => {
  it("precondition 抛 ApiError → 透传, update/audit 都不写", async () => {
    await expect(
      prisma.$transaction(async (tx) =>
        runTransitionInTx(tx, {
          entity: "Contract",
          loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
          from: ["DRAFT"],
          to: "ACTIVE",
          precondition: () => {
            throw new (class extends Error {
              errorCode = "VALIDATION_FAILED";
              status = 400;
            })("字段不完整");
          },
          audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        })
      )
    ).rejects.toMatchObject({ errorCode: "VALIDATION_FAILED" });
    expect(mockState.updateCalls).toHaveLength(0);
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("precondition 抛非 ApiError → 透传原 Error", async () => {
    await expect(
      prisma.$transaction(async (tx) =>
        runTransitionInTx(tx, {
          entity: "Contract",
          loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
          from: ["DRAFT"],
          to: "ACTIVE",
          precondition: () => {
            throw new Error("random");
          },
          audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        })
      )
    ).rejects.toThrow("random");
  });

  it("precondition 抛 SkipTransition → 总是 SKIPPED (无视 silentSkip)", async () => {
    const r = await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        precondition: () => {
          throw new SkipTransition();
        },
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    );
    expect(r.result).toBe("SKIPPED");
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe("runTransitionInTx - extraData", () => {
  it("extraData 透传额外字段到 update (如 closeContract 写 reviewComment)", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "CLOSED",
        extraData: () => ({ reviewComment: "测试关闭" }),
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    );
    expect(mockState.updateCalls[0]!.data.status).toBe("CLOSED");
    expect(mockState.updateCalls[0]!.data.reviewComment).toBe("测试关闭");
  });
});

describe("runTransitionInTx - dispatch", () => {
  it("entity=Invoice → 调 tx.invoice.update (不是 contract.update)", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: (t) => t.invoice.findFirst({ where: { id: "i-1" } }),
        from: ["DRAFT"],
        to: "PENDING_FINANCE",
        audit: () => ({ actorId: "u-1", action: "INV_SUBMIT", before: {}, after: {} }),
      })
    );
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0]!.entity).toBe("Invoice");
    expect(mockState.updateCalls[0]!.data.status).toBe("PENDING_FINANCE");
  });

  it("entity=Payment → 调 tx.payment.update", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: (t) => t.payment.findFirst({ where: { id: "p-1" } }),
        from: ["PLANNED"],
        to: "CONFIRMED",
        audit: () => ({ actorId: "u-1", action: "PAY_CONFIRM", before: {}, after: {} }),
      })
    );
    expect(mockState.updateCalls[0]!.entity).toBe("Payment");
    expect(mockState.updateCalls[0]!.data.status).toBe("CONFIRMED");
  });

  it("reviewLog 提供 + entity=Contract → 写 tx.contractReviewLog.create", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        reviewLog: () => ({ reviewerId: SYSTEM_USER_ID, action: "AUTO_PUBLISH" }),
      })
    );
    expect(mockState.reviewLogCalls).toHaveLength(1);
    expect(mockState.reviewLogCalls[0]!.action).toBe("AUTO_PUBLISH");
  });

  it("reviewLog 提供 + entity=Invoice → 不写 (只有 Contract 走 reviewLog 表)", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: (t) => t.invoice.findFirst({ where: { id: "i-1" } }),
        from: ["DRAFT"],
        to: "PENDING_FINANCE",
        audit: () => ({ actorId: "u-1", action: "INV_SUBMIT", before: {}, after: {} }),
        reviewLog: () => ({ reviewerId: "u-1", action: "REVIEW" }),
      })
    );
    expect(mockState.reviewLogCalls).toHaveLength(0);
  });

  it("event 留空 → 不调 emit", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    );
    expect(mockState.emitCalls).toHaveLength(0);
  });

  it("event 提供 → 调 emit, type/payload/receivers 透传", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
        event: async () => ({
          type: "CONTRACT_AUTO_EXECUTED" as const,
          payload: { contractId: "c-1" },
          receivers: ["u-admin-1"],
        }),
      })
    );
    expect(mockState.emitCalls).toHaveLength(1);
    expect(mockState.emitCalls[0]!.type).toBe("CONTRACT_AUTO_EXECUTED");
    expect(mockState.emitCalls[0]!.receivers).toEqual(["u-admin-1"]);
  });
});

describe("runTransitionInTx - audit 字段", () => {
  it("audit.before / after 透传给 audit() 库, 附 entity / entityId", async () => {
    await prisma.$transaction(async (tx) =>
      runTransitionInTx(tx, {
        entity: "Contract",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        audit: () => ({
          actorId: SYSTEM_USER_ID,
          action: "TEST",
          before: { status: "DRAFT" },
          after: { status: "ACTIVE" },
        }),
      })
    );
    expect(mockState.auditCalls[0]!).toMatchObject({
      action: "TEST",
      entity: "Contract",
      entityId: "c-1",
      before: { status: "DRAFT" },
      after: { status: "ACTIVE" },
    });
  });
});

describe("runTransitionInTx - mismatchError 自定义", () => {
  it("提供 mismatchError → 抛自定义 code 而非默认 ENTITY_IMMUTABLE", async () => {
    // 状态 SIGNED 不在 from 列表中, 触发 mismatch 路径
    mockState.contract = { id: "c-1", status: "SIGNED", contractNo: "X", ownerUserId: "u-1" };
    await expect(
      prisma.$transaction(async (tx) =>
        runTransitionInTx(tx, {
          entity: "Contract",
          loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
          from: ["LEAD"],
          to: "ACTIVE",
          audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
          mismatchError: {
            code: "CUSTOMER_STATUS_TRANSITION_INVALID" as typeof ERROR_CODES[keyof typeof ERROR_CODES],
            status: 422,
            message: (cur, to) => `客户 ${cur.status} → ${to} 不合法`,
          },
        })
      )
    ).rejects.toMatchObject({
      errorCode: "CUSTOMER_STATUS_TRANSITION_INVALID",
      status: 422,
    });
  });
});

describe("runTransition - P2034 重试", () => {
  it("第一次 P2034, 第二次成功 → 返回 { result: DONE }", async () => {
    mockState.p2034Count = 1;
    const r = await runTransition({
      entity: "Contract",
      id: "c-1",
      loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
      from: ["DRAFT"],
      to: "ACTIVE",
      silentSkip: true,
      audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
    });
    expect(r.result).toBe("DONE");
    expect(mockState.updateCalls).toHaveLength(1);
    // 跑了 2 次事务 (第 1 次 P2034, 第 2 次成功)
    expect(mockState.txnCalls).toBe(2);
  });

  it("3 次都 P2034 → 抛 Prisma 错误 (重试耗尽)", async () => {
    mockState.p2034Count = 5; // 超过 SERIALIZABLE_RETRY (3)
    await expect(
      runTransition({
        entity: "Contract",
        id: "c-1",
        loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
        from: ["DRAFT"],
        to: "ACTIVE",
        silentSkip: true,
        audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // 3 次事务都失败
    expect(mockState.txnCalls).toBe(3);
  });
});

describe("runTransitionInTx - 集成", () => {
  it("嵌在外层事务不嵌套 (不调 prisma.$transaction)", async () => {
    const outerTx = {
      contract: {
        findFirst: vi.fn(async () => mockState.contract),
        update: vi.fn(async () => ({ id: "c-1", status: "ACTIVE" })),
      },
    } as unknown as Prisma.TransactionClient;
    const txnCallsBefore = mockState.txnCalls;
    const r = await runTransitionInTx(outerTx, {
      entity: "Contract",
      loadInTx: (t) => t.contract.findFirst({ where: { id: "c-1" } }),
      from: ["DRAFT"],
      to: "ACTIVE",
      audit: () => ({ actorId: SYSTEM_USER_ID, action: "X", before: {}, after: {} }),
    });
    expect(r.result).toBe("DONE");
    // 不应该再调 prisma.$transaction
    expect(mockState.txnCalls).toBe(txnCallsBefore);
  });
});
