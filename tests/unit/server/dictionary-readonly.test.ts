// 只读类目 (lib/dict-domain.ts DICT_META.readonly) 拒写回归:
// createDict / updateDict / softDisableDict / reorder 对 readonly 类目一律 403;
// 非白名单类目仍 400; 可写类目不受影响。
// 不连真实 DB, 用 vi.mock 拦截 prisma (pattern 同 tests/unit/server/contract-create-owner.test.ts)
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dictionary: {
      findUnique: vi.fn(async () => ({
        id: "d-1",
        category: "CONTRACT_STATUS",
        code: "DRAFT",
        label: "草稿",
        isActive: true
      })),
      findMany: vi.fn(async () => [{ category: "CONTRACT_STATUS" }]),
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("@/server/audit", () => ({ audit: vi.fn(async () => ({})) }));

import { createDict, updateDict, softDisableDict, reorder } from "@/server/services/dictionary";
import type { SessionUser } from "@/lib/session";

const ADMIN = { id: "u-admin", roleCode: "ADMIN" } as unknown as SessionUser;

describe("dictionary 只读类目拒写", () => {
  it("createDict: readonly 类目 (CONTRACT_STATUS) → 403", async () => {
    await expect(
      createDict(ADMIN, { category: "CONTRACT_STATUS", code: "X_NEW", label: "新状态" })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("updateDict: 目标属于 readonly 类目 → 403", async () => {
    await expect(updateDict(ADMIN, "d-1", { label: "改名" })).rejects.toMatchObject({ status: 403 });
  });

  it("softDisableDict: 目标属于 readonly 类目 → 403", async () => {
    await expect(softDisableDict(ADMIN, "d-1")).rejects.toMatchObject({ status: 403 });
  });

  it("reorder: 涉及 readonly 类目 → 403", async () => {
    await expect(reorder(ADMIN, [{ id: "d-1", sort: 1 }])).rejects.toMatchObject({ status: 403 });
  });

  it("createDict: 非白名单类目仍 400", async () => {
    await expect(
      createDict(ADMIN, { category: "FAKE_CATEGORY", code: "X", label: "x" })
    ).rejects.toMatchObject({ status: 400 });
  });
});
