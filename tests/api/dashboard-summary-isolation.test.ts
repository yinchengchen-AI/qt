// dashboard/summary 镇街分布行级隔离回归
//
// SALES / EXPERT 只能统计自己拥有的客户, ADMIN 统计全部客户。
// DB 不可达时明确 skip。数据使用唯一 TAG_TOWN,跑完按 FK 反向顺序严格清理。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { GET as getDashboardSummary } from "@/app/api/dashboard/summary/route";

const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      return sessionHolder.actor;
    }
  };
});

let dbReachable = false;
const TAG = `TEST-DASH-TOWN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TAG_TOWN = `${TAG}-TOWN`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let expertUser: SessionUser | null = null;
const userIds: string[] = [];
const customerIds: string[] = [];

async function makeUser(roleCode: "ADMIN" | "SALES" | "EXPERT"): Promise<SessionUser> {
  const suffix = roleCode.toLowerCase();
  const user = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-${suffix}`,
      name: `${TAG}-${roleCode}`,
      email: `${TAG}-${suffix}@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: roleCode } }
    },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  userIds.push(user.id);
  return { ...user, roleCode, permissions: [] };
}

async function makeCustomer(suffix: string, owner: SessionUser) {
  const customer = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST-${suffix}`,
      name: `${TAG}-客户-${suffix}`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      town: TAG_TOWN,
      contactPhone: "13800000000",
      createdById: owner.id,
      updatedById: owner.id,
      ownerUserId: owner.id
    }
  });
  customerIds.push(customer.id);
}

type SummaryBody = {
  code: number;
  data: { townDistribution: Array<{ town: string; count: number }> };
};

async function callSummary(actor: SessionUser): Promise<SummaryBody> {
  sessionHolder.actor = actor;
  const response = await getDashboardSummary(new Request("http://localhost/api/dashboard/summary?range=year"));
  return response.json() as Promise<SummaryBody>;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }

  adminUser = await makeUser("ADMIN");
  salesUser = await makeUser("SALES");
  expertUser = await makeUser("EXPERT");
  await makeCustomer("admin", adminUser);
  await makeCustomer("sales", salesUser);
  await makeCustomer("expert", expertUser);
});

afterAll(async () => {
  if (!dbReachable) return;
  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("dashboard/summary 镇街分布隔离", () => {
  it("SALES / EXPERT 只统计自己的客户,ADMIN 统计全部客户", async (ctx) => {
    if (!dbReachable || !adminUser || !salesUser || !expertUser) return ctx.skip();

    const salesBody = await callSummary(salesUser);
    const expertBody = await callSummary(expertUser);
    const adminBody = await callSummary(adminUser);

    expect(salesBody.code).toBe(0);
    expect(expertBody.code).toBe(0);
    expect(adminBody.code).toBe(0);
    expect(salesBody.data.townDistribution.find((x) => x.town === TAG_TOWN)?.count).toBe(1);
    expect(expertBody.data.townDistribution.find((x) => x.town === TAG_TOWN)?.count).toBe(1);
    expect(adminBody.data.townDistribution.find((x) => x.town === TAG_TOWN)?.count).toBe(3);
  });
});
