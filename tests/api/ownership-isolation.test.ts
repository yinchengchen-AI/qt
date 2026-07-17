// C2 / H1 行级隔离回归
//
//   C2: EXPERT 角色此前零隔离 (ownership.ts 只判 SALES), 可读/改/导出全公司数据。
//       修复后 ownerEq/ownerViaContract 对 SALES + EXPERT 都注入 ownerUserId = 自己。
//   H1: getInvoiceAging 的 query.ownerUserId 入参此前用对象展开**覆盖**隔离条件,
//       SALES 传他人 id 即可看/导出他人账龄。修复后受限角色强制等于自己。
//
// DB 不可达时账龄用例 skip; ownership 助手的纯函数用例不依赖 DB 始终可跑。

import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ownerEq, ownerViaContract, isRowRestricted } from "@/lib/ownership";
import { getInvoiceAging } from "@/server/services/statistics";

function mkUser(roleCode: SessionUser["roleCode"], id = `user-${roleCode.toLowerCase()}`): SessionUser {
  return { id, employeeNo: id, name: id, email: `${id}@t.local`, roleCode, permissions: [] };
}

describe("C2: ownership 助手对 SALES + EXPERT 都隔离", () => {
  it("SALES 与 EXPERT 均判定为受限角色", () => {
    expect(isRowRestricted(mkUser("SALES"))).toBe(true);
    expect(isRowRestricted(mkUser("EXPERT"))).toBe(true);
  });

  it("ADMIN / FINANCE / OPS 不受限", () => {
    expect(isRowRestricted(mkUser("ADMIN"))).toBe(false);
    expect(isRowRestricted(mkUser("FINANCE"))).toBe(false);
    expect(isRowRestricted(mkUser("OPS"))).toBe(false);
  });

  it("ownerEq: EXPERT 也注入自己的 ownerUserId (此前是 {} 零过滤)", () => {
    const expert = mkUser("EXPERT", "expert-1");
    expect(ownerEq(expert)).toEqual({ ownerUserId: "expert-1" });
    expect(ownerEq(mkUser("SALES", "sales-1"))).toEqual({ ownerUserId: "sales-1" });
    expect(ownerEq(mkUser("ADMIN"))).toEqual({});
  });

  it("ownerViaContract: EXPERT 也注入 contract.ownerUserId", () => {
    const expert = mkUser("EXPERT", "expert-2");
    expect(ownerViaContract(expert)).toEqual({ contract: { ownerUserId: "expert-2" } });
    expect(ownerViaContract(mkUser("FINANCE"))).toEqual({});
  });
});

describe("H1: getInvoiceAging 越权 (SALES 传他人 ownerUserId)", () => {
  let dbReachable = false;
  let salesId: string | null = null;
  let otherId: string | null = null;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    // 取两个真实存在的用户 id 作为"自己"和"他人"的入参
    const users = await prisma.user.findMany({ where: { deletedAt: null }, take: 2, select: { id: true } });
    salesId = users[0]?.id ?? null;
    otherId = users[1]?.id ?? null;
  });

  it("受限角色传他人 ownerUserId, 结果仍只含自己的发票", async () => {
    if (!dbReachable || !salesId || !otherId) return;
    const sales = mkUser("SALES", salesId);
    // 恶意入参: 指定他人的 ownerUserId —— 修复后应被强制改回 salesId
    const res = await getInvoiceAging(sales, { ownerUserId: otherId, pageSize: 200 });
    for (const row of res.rows) {
      expect(row.ownerUserId).toBe(salesId);
    }
  });

  it("EXPERT 同样被强制只能看自己", async () => {
    if (!dbReachable || !salesId || !otherId) return;
    const expert = mkUser("EXPERT", salesId);
    const res = await getInvoiceAging(expert, { ownerUserId: otherId, pageSize: 200 });
    for (const row of res.rows) {
      expect(row.ownerUserId).toBe(salesId);
    }
  });
});
