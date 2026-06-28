// 软删统一入口 (lib/soft-delete.ts) 单元测试
//
// 用 vi.mock 拦截 prisma.$transaction + audit, 不依赖真实 DB.
// 重点覆盖:
//   - 主路径: 子数据为空 → update 写 deletedAt, audit 写 SOFT_DELETE
//   - 边界: 子数据非空抛 ENTITY_IMMUTABLE / 记录不存在抛 NOT_FOUND / 已软删抛 NOT_FOUND
//   - P2034 重试: 1 次后成功 / 3 次都失败抛错
//   - audit 字段: before 透传, after 固定 { deleted: true }
//   - 行级隔离: findInTx 注入 ownershipWhere 找不到时 NOT_FOUND
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { Prisma } from "@prisma/client";

const mockState = vi.hoisted(() => ({
  existing: { id: "c-1", deletedAt: null as Date | null, status: "ACTIVE", contractNo: "X" } as Record<string, unknown> | null,
  subDataCount: 0,
  updateCalls: [] as Array<{ id: string; data: Record<string, unknown> }>,
  auditCalls: [] as Array<{ action: string; entity: string; entityId: string; before?: unknown; after?: unknown }>,
  p2034Count: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) => {
      if (mockState.p2034Count > 0) {
        mockState.p2034Count--;
        throw new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "7" });
      }
      const tx = {
        contract: {
          findFirst: vi.fn(async () => mockState.existing),
          update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            mockState.updateCalls.push({ id: where.id, data });
            return { id: where.id, ...data };
          }),
        },
        invoice: { count: vi.fn(async () => mockState.subDataCount) },
        payment: { count: vi.fn(async () => mockState.subDataCount) },
        attachment: { count: vi.fn(async () => mockState.subDataCount) },
      };
      return fn(tx);
    }),
  },
}));

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (_tx: unknown, input: { action: string; entity: string; entityId: string; before?: unknown; after?: unknown }) => {
    mockState.auditCalls.push(input);
  }),
}));


// Mock tx 接口 — 软删测试只需 contract.findFirst/update + invoice/payment/attachment.count
type ContractRecord = { id: string; deletedAt: Date | null };
type MockTx = {
  contract: {
    findFirst: (...a: unknown[]) => Promise<ContractRecord | null>;
    update: (...a: unknown[]) => Promise<ContractRecord>;
  };
  invoice: { count: (...a: unknown[]) => Promise<number> };
  payment: { count: (...a: unknown[]) => Promise<number> };
  attachment: { count: (...a: unknown[]) => Promise<number> };
};
const asTx = (tx: unknown): MockTx => tx as MockTx;

import { softDelete } from "@/lib/soft-delete";

const adminUser = { id: "u-admin", employeeNo: "A", name: "A", email: "a@x", roleCode: "ADMIN" as const, permissions: [] };

beforeEach(() => {
  mockState.existing = { id: "c-1", deletedAt: null, status: "ACTIVE", contractNo: "X" };
  mockState.subDataCount = 0;
  mockState.updateCalls = [];
  mockState.auditCalls = [];
  mockState.p2034Count = 0;
});

describe("softDelete - 主路径", () => {
  it("子数据为空 → DONE, update 写 deletedAt, audit 写 SOFT_DELETE", async () => {
    const r = await softDelete(adminUser, {
      entity: "Contract",
      id: "c-1",
      findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
      updateInTx: (tx, id, deletedAt, actorId) =>
        asTx(tx).contract.update({
          where: { id },
          data: { deletedAt, updatedById: actorId },
        }),
      preDeleteCheck: async () => {},
      audit: { actorId: adminUser.id, before: { status: "ACTIVE", contractNo: "X" } },
    });
    expect(r.id).toBe("c-1");
    expect(mockState.updateCalls[0]!.data.deletedAt).toBeInstanceOf(Date);
    expect(mockState.auditCalls[0]!.action).toBe("CONTRACT_SOFT_DELETE");
    expect(mockState.auditCalls[0]!.after).toEqual({ deleted: true });
  });

  it("子数据非空 → 抛 ENTITY_IMMUTABLE, 删除未发生", async () => {
    mockState.subDataCount = 3;
    await expect(
      softDelete(adminUser, {
        entity: "Contract",
        id: "c-1",
        findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
        updateInTx: (tx, id, deletedAt, actorId) =>
          asTx(tx).contract.update({
            where: { id },
            data: { deletedAt, updatedById: actorId },
          }),
        preDeleteCheck: async (tx) => {
          const inv = await asTx(tx).invoice.count({
            where: { contractId: "c-1", deletedAt: null },
          });
          if (inv > 0) throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "存在子数据", 403);
        },
        audit: { actorId: adminUser.id, before: {} },
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE });
    expect(mockState.updateCalls).toHaveLength(0);
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("记录不存在 → 抛 NOT_FOUND", async () => {
    mockState.existing = null;
    await expect(
      softDelete(adminUser, {
        entity: "Contract",
        id: "c-1",
        findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
        updateInTx: (tx, id, deletedAt, actorId) =>
          asTx(tx).contract.update({
            where: { id },
            data: { deletedAt, updatedById: actorId },
          }),
        preDeleteCheck: async () => {},
        audit: { actorId: adminUser.id, before: {} },
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  });

  it("记录已软删 → 抛 NOT_FOUND", async () => {
    mockState.existing = { id: "c-1", deletedAt: new Date(), status: "X", contractNo: "X" };
    await expect(
      softDelete(adminUser, {
        entity: "Contract",
        id: "c-1",
        findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
        updateInTx: (tx, id, deletedAt, actorId) =>
          asTx(tx).contract.update({
            where: { id },
            data: { deletedAt, updatedById: actorId },
          }),
        preDeleteCheck: async () => {},
        audit: { actorId: adminUser.id, before: {} },
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  });
});

describe("softDelete - P2034 重试", () => {
  it("1 次 P2034 后成功 → 返回 { id, deletedAt }", async () => {
    mockState.p2034Count = 1;
    const r = await softDelete(adminUser, {
      entity: "Contract",
      id: "c-1",
      findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
      updateInTx: (tx, id, deletedAt, actorId) =>
        asTx(tx).contract.update({
          where: { id },
          data: { deletedAt, updatedById: actorId },
        }),
      preDeleteCheck: async () => {},
      audit: { actorId: adminUser.id, before: {} },
    });
    expect(r.id).toBe("c-1");
    expect(r.deletedAt).toBeInstanceOf(Date);
  });

  it("3 次都 P2034 → 抛 Prisma 错误", async () => {
    mockState.p2034Count = 5; // 超过 SERIALIZABLE_RETRY
    await expect(
      softDelete(adminUser, {
        entity: "Contract",
        id: "c-1",
        findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
        updateInTx: (tx, id, deletedAt, actorId) =>
          asTx(tx).contract.update({
            where: { id },
            data: { deletedAt, updatedById: actorId },
          }),
        preDeleteCheck: async () => {},
        audit: { actorId: adminUser.id, before: {} },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("softDelete - audit 字段", () => {
  it("audit.before 透传, after 固定 { deleted: true }", async () => {
    await softDelete(adminUser, {
      entity: "Contract",
      id: "c-1",
      findInTx: (tx, id) => asTx(tx).contract.findFirst({ where: { id } }),
      updateInTx: (tx, id, deletedAt, actorId) =>
        asTx(tx).contract.update({
          where: { id },
          data: { deletedAt, updatedById: actorId },
        }),
      preDeleteCheck: async () => {},
      audit: { actorId: adminUser.id, before: { status: "ACTIVE", contractNo: "QT-HT-X" } },
    });
    expect(mockState.auditCalls[0]!.before).toEqual({ status: "ACTIVE", contractNo: "QT-HT-X" });
    expect(mockState.auditCalls[0]!.after).toEqual({ deleted: true });
    expect(mockState.auditCalls[0]!.entity).toBe("Contract");
    expect(mockState.auditCalls[0]!.entityId).toBe("c-1");
  });
});

describe("softDelete - 行级隔离", () => {
  it("findInTx 注入 ownershipWhere, 找不到时 NOT_FOUND", async () => {
    // 模拟 ownershipWhere 命中 0 行 → findFirst 返回 null
    mockState.existing = null;
    const findInTxWithOwner = (tx: unknown, id: string) =>
      asTx(tx).contract.findFirst({ where: { id, ownerUserId: "u-other" } });
    await expect(
      softDelete(adminUser, {
        entity: "Contract",
        id: "c-1",
        findInTx: findInTxWithOwner,
        updateInTx: (tx, id, deletedAt, actorId) =>
          asTx(tx).contract.update({
            where: { id },
            data: { deletedAt, updatedById: actorId },
          }),
        preDeleteCheck: async () => {},
        audit: { actorId: adminUser.id, before: {} },
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
    expect(mockState.updateCalls).toHaveLength(0);
  });
});
