// AI 用量统计 service/接口回归测试 (真实 DB, 不可达时整组 skip)
//
// 覆盖:
//   - 权限: 非 ADMIN (无 OPERATION_LOG READ) 查询 → 403
//   - 列表 + 汇总口径: 总调用 / 缓存命中率 / token 合计 / 成本合计 / 失败数 / 平均耗时
//   - 过滤: cacheHit / status / userKeyword(姓名/工号) / 时间范围
//   - 分页: page/pageSize
//   - buildAiUsageWhere 纯函数
// 数据隔离: fixture 全部打 feature=TEST_AI_USAGE 标记, afterAll 按标记清理。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { buildAiUsageWhere, listAiUsageLogs } from "@/server/services/ai-usage";

const FEATURE = "TEST_AI_USAGE";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false }, select: { id: true, employeeNo: true, name: true, email: true } })
  ]);
  if (!adminRow || !salesRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  await prisma.aiUsageLog.createMany({
    data: [
      { feature: FEATURE, userId: adminRow.id, model: "deepseek-chat", cacheHit: false, promptTokens: 100, completionTokens: 50, costEstimate: 0.000082, latencyMs: 1200, status: "SUCCESS" },
      { feature: FEATURE, userId: salesRow.id, model: "deepseek-chat", cacheHit: true, promptTokens: 0, completionTokens: 0, costEstimate: null, latencyMs: 0, status: "SUCCESS" },
      { feature: FEATURE, userId: adminRow.id, model: "deepseek-chat", cacheHit: false, promptTokens: 0, completionTokens: 0, costEstimate: null, latencyMs: 300, status: "FAILURE", errorMessage: "AI 服务异常 (HTTP 500)" }
    ]
  });
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    await prisma.aiUsageLog.deleteMany({ where: { feature: FEATURE } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

describe("buildAiUsageWhere 纯函数", () => {
  it("组合过滤: feature/status/cacheHit/userIds/时间范围", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-10-21T00:00:00Z");
    const where = buildAiUsageWhere({
      feature: FEATURE,
      status: "FAILURE",
      cacheHit: false,
      userIds: ["u1", "u2"],
      from,
      to
    });
    expect(where).toEqual({
      feature: FEATURE,
      status: "FAILURE",
      cacheHit: false,
      userId: { in: ["u1", "u2"] },
      createdAt: { gte: from, lte: to }
    });
  });

  it("空条件 → 空 where", () => {
    expect(buildAiUsageWhere({})).toEqual({});
  });
});

describe("AI 用量统计 (真实 DB)", () => {
  it("非 ADMIN → 403", guard(async () => {
    await expect(listAiUsageLogs(salesUser!, { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
  }));

  it("ADMIN 按 feature 过滤: 列表 + 汇总口径正确", guard(async () => {
    const r = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 20, feature: FEATURE });
    expect(r.total).toBe(3);
    expect(r.list).toHaveLength(3);
    expect(r.summary.totalCalls).toBe(3);
    expect(r.summary.cacheHitCount).toBe(1);
    expect(r.summary.cacheHitRate).toBe(33);
    expect(r.summary.failureCount).toBe(1);
    expect(r.summary.promptTokens).toBe(100);
    expect(r.summary.completionTokens).toBe(50);
    expect(r.summary.costEstimate).toBeCloseTo(0.000082, 6);
    expect(r.summary.avgLatencyMs).toBe(500); // (1200 + 0 + 300) / 3
    // 行内补用户信息
    const hit = r.list.find((x) => x.cacheHit);
    expect(hit?.userName).toBe(salesUser!.name);
    expect(hit?.userEmployeeNo).toBe(salesUser!.employeeNo);
  }));

  it("cacheHit / status 过滤", guard(async () => {
    const hits = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 20, feature: FEATURE, cacheHit: true });
    expect(hits.total).toBe(1);
    const failures = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 20, feature: FEATURE, status: "FAILURE" });
    expect(failures.total).toBe(1);
    expect(failures.list[0]?.errorMessage).toContain("HTTP 500");
  }));

  it("userKeyword (工号/姓名) 过滤", guard(async () => {
    const byNo = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 20, feature: FEATURE, userKeyword: salesUser!.employeeNo });
    expect(byNo.total).toBe(1);
    expect(byNo.list[0]?.userId).toBe(salesUser!.id);
    // 无命中关键字 → 空结果 (不误放行全量)
    const none = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 20, feature: FEATURE, userKeyword: "__no_such_user__" });
    expect(none.total).toBe(0);
  }));

  it("时间范围过滤", guard(async () => {
    const future = await listAiUsageLogs(adminUser!, {
      page: 1,
      pageSize: 20,
      feature: FEATURE,
      from: new Date(Date.now() + 3600_000)
    });
    expect(future.total).toBe(0);
    const past = await listAiUsageLogs(adminUser!, {
      page: 1,
      pageSize: 20,
      feature: FEATURE,
      from: new Date(Date.now() - 3600_000)
    });
    expect(past.total).toBe(3);
  }));

  it("分页: pageSize=2 第一页 2 行, 第二页 1 行", guard(async () => {
    const p1 = await listAiUsageLogs(adminUser!, { page: 1, pageSize: 2, feature: FEATURE });
    expect(p1.list).toHaveLength(2);
    expect(p1.total).toBe(3);
    const p2 = await listAiUsageLogs(adminUser!, { page: 2, pageSize: 2, feature: FEATURE });
    expect(p2.list).toHaveLength(1);
  }));
});
