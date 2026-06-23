// 客户列表 (listCustomers) 新增过滤参数 单元测试:
//   industry / province / ownerUserId / createdAtFrom / createdAtTo 必须能正确拼进 Prisma where.
// 不依赖真实 DB, 用 vi.mock 拦截 prisma.customer.findMany / .count 拿 where 自己断言.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  findManyArgs: null as null | { where: Record<string, unknown> },
  countArgs: null as null | { where: Record<string, unknown> }
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        mockState.findManyArgs = args;
        return [];
      }),
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        mockState.countArgs = args;
        return 0;
      })
    }
  }
}));

import { listCustomers } from "@/server/services/customer";

const admin = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: null,
  phone: null,
  roleCode: "ADMIN"
} as unknown as Parameters<typeof listCustomers>[0];

beforeEach(() => {
  mockState.findManyArgs = null;
  mockState.countArgs = null;
});

describe("listCustomers - 新增过滤参数拼接进 where", () => {
  it("industry 单值走 in: [code]", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, industry: "FINANCE" });
    expect(mockState.findManyArgs?.where.industry).toEqual({ in: ["FINANCE"] });
  });

  it("industry 多值 (逗号分隔) 走 in: [code1, code2]", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, industry: "FINANCE,EDU" });
    expect(mockState.findManyArgs?.where.industry).toEqual({ in: ["FINANCE", "EDU"] });
  });

  it("province 精确匹配 equals + insensitive (cascader 给的就是 DB label)", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, province: "浙江省" });
    expect(mockState.findManyArgs?.where.province).toEqual({
      equals: "浙江省",
      mode: "insensitive"
    });
  });

  it("city 精确匹配 equals + insensitive", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, city: "杭州市" });
    expect(mockState.findManyArgs?.where.city).toEqual({
      equals: "杭州市",
      mode: "insensitive"
    });
  });

  it("district 精确匹配 equals + insensitive", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, district: "西湖区" });
    expect(mockState.findManyArgs?.where.district).toEqual({
      equals: "西湖区",
      mode: "insensitive"
    });
  });

  it("town 精确匹配 equals + insensitive", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, town: "留下街道" });
    expect(mockState.findManyArgs?.where.town).toEqual({
      equals: "留下街道",
      mode: "insensitive"
    });
  });

  it("省市区镇街 4 级一起传, 全部进 where (级联精确匹配)", async () => {
    await listCustomers(admin, {
      page: 1,
      pageSize: 20,
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      town: "留下街道"
    });
    const w = mockState.findManyArgs!.where;
    expect(w.province).toEqual({ equals: "浙江省", mode: "insensitive" });
    expect(w.city).toEqual({ equals: "杭州市", mode: "insensitive" });
    expect(w.district).toEqual({ equals: "西湖区", mode: "insensitive" });
    expect(w.town).toEqual({ equals: "留下街道", mode: "insensitive" });
  });

  it("ownerUserId 精确匹配", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, ownerUserId: "u-2" });
    expect(mockState.findManyArgs?.where.ownerUserId).toBe("u-2");
  });

  it("createdAtFrom + createdAtTo 拼成 { gte, lte }", async () => {
    await listCustomers(admin, {
      page: 1,
      pageSize: 20,
      createdAtFrom: "2024-01-01",
      createdAtTo: "2024-03-31"
    });
    const range = mockState.findManyArgs?.where.createdAt as { gte: Date; lte: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeInstanceOf(Date);
    expect(range.gte.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(range.lte.toISOString()).toBe("2024-03-31T00:00:00.000Z");
  });

  it("只传 createdAtFrom 时只拼 gte", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, createdAtFrom: "2024-01-01" });
    const range = mockState.findManyArgs?.where.createdAt as { gte?: Date; lte?: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeUndefined();
  });

  it("只传 createdAtTo 时只拼 lte", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, createdAtTo: "2024-12-31" });
    const range = mockState.findManyArgs?.where.createdAt as { gte?: Date; lte?: Date };
    expect(range.lte).toBeInstanceOf(Date);
    expect(range.gte).toBeUndefined();
  });

  it("createdAtFrom 非法字符串时该条件被忽略, 不影响其他过滤", async () => {
    await listCustomers(admin, {
      page: 1,
      pageSize: 20,
      createdAtFrom: "not-a-date",
      industry: "FINANCE"
    });
    expect(mockState.findManyArgs?.where.createdAt).toBeUndefined();
    expect(mockState.findManyArgs?.where.industry).toEqual({ in: ["FINANCE"] });
  });

  it("全部新条件一起传, where 里所有分支都拼上", async () => {
    await listCustomers(admin, {
      page: 1,
      pageSize: 20,
      industry: "FINANCE",
      province: "浙江",
      ownerUserId: "u-2",
      createdAtFrom: "2024-01-01",
      createdAtTo: "2024-12-31"
    });
    const w = mockState.findManyArgs!.where;
    expect(w.industry).toEqual({ in: ["FINANCE"] });
    expect(w.province).toEqual({ equals: "浙江", mode: "insensitive" });
    expect(w.ownerUserId).toBe("u-2");
    expect((w.createdAt as { gte: Date; lte: Date }).gte).toBeInstanceOf(Date);
    expect((w.createdAt as { gte: Date; lte: Date }).lte).toBeInstanceOf(Date);
  });

  it("count 路径也用同一个 where (分页总数与列表同步)", async () => {
    await listCustomers(admin, { page: 1, pageSize: 20, industry: "FINANCE" });
    expect(mockState.countArgs?.where.industry).toEqual({ in: ["FINANCE"] });
  });
});
