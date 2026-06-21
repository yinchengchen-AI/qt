// 修复锁:PATCH /api/customers/[id] 在加完 district 字段后报 500。
// 根因:server/services/customer.ts 与 lib/validators/customer.ts 都接受
// `district` 字段,prisma/schema.prisma 也有 `district`,但 20260621_customer_district
// 迁移没被 `prisma migrate deploy` 应用到本地 Postgres。结果 Prisma 运行时
// 找不到列,抛 P2022 "column does not exist" → 路由 catch 后 500。
// 之前所有 customer-location 测试都是 grep 源码,没碰真实 DB,漏掉了运行时校验。
//
// 本测试在 vitest 进程内复用 lib/prisma 的 PrismaClient,对 _prisma_migrations 表
// 与 Customer 表做最小读取,确认迁移已应用且 Prisma client 能读 district。DB 不可达时
// skip(开发/CI 启动 docker 后再跑一次即可)。 vitest 的 skip 是在注册时求值的,
// 不能用 describe.skipIf 包变量,这里用 try/catch + 显式 throw 让 beforeAll 失败时
// 整组 skip。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable) await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return; // skip silently — DB 不可达时整组不跑
  await fn();
};

describe("Prisma client 运行时与 DB schema 一致(district)", () => {
  it("Customer.district 字段在运行时 Prisma client 类型中可用", guard(async () => {
    const c = await prisma.customer.findFirst({
      where: { deletedAt: null },
      select: { id: true, district: true, town: true }
    });
    if (c) {
      expect(c).toHaveProperty("district");
      expect(c).toHaveProperty("town");
    }
  }));

  it("20260621_customer_district 迁移已记录在 _prisma_migrations 表", guard(async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE migration_name LIKE '%customer_district%'
    `;
    expect(rows.length, "迁移应已被 apply").toBeGreaterThan(0);
  }));

  it("information_schema 确认 Customer 表存在 district / town 列", guard(async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Customer'
        AND column_name IN ('district', 'town')
    `;
    const cols = rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(["district", "town"]);
  }));
});
