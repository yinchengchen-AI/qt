// Phase 2 合同风险预警引擎 API/job 集成测试
//
// 覆盖:
//   1) risk-score-snapshot job: 快照幂等 (跑两遍行数不变)
//   2) 升档检测: 昨日 LOW → 今日 HIGH 发 RISK_LEVEL_UP 给 owner+admin; 同日重跑不重复 (entityKey 去重)
//   3) 低分合同只写快照不发消息
//   4) admin 当日汇总消息 (HIGH/CRITICAL 存在时)
//   5) getMyRisks: 只含本人 MEDIUM+, 按分数降序
//   6) getMyStats.risk = HIGH+CRITICAL 计数 (>= 1, 兼容 dev 库其它数据)
//   7) getContractRisk: 含 trend/recommendations; 不存在 → null
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { runRiskScoreSnapshot } from "@/server/jobs/risk-score-snapshot";
import { getMyRisks, getMyStats, getContractRisk } from "@/server/services/contract/workbench";

let dbReachable = false;
const TAG = `TEST-RISK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 86_400_000;
const testStart = new Date();

let salesUser: SessionUser | null = null;
let salesId = "";
let customerId: string | null = null;
let cHighId: string | null = null;
let cLowId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // 并发隔离: 新建专属 SALES 用户 (不用 seed 共享账号), 避免与其它测试文件的 fixture 互踩
  const salesRow = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-S`,
      name: `${TAG}-销售`,
      email: `${TAG}-sales@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } }
    },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  salesId = salesRow.id;
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000999",
      ownerUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  customerId = cust.id;

  const now = Date.now();
  const base = {
    customerId: cust.id,
    customerName: `${TAG}-客户`,
    serviceType: "OTHER",
    totalAmount: 100000,
    taxRate: 0.06,
    taxAmount: Number((100000 * 0.06 / 1.06).toFixed(2)),
    amountExcludingTax: Number((100000 / 1.06).toFixed(2)),
    paymentMethod: "LUMP_SUM",
    status: "ACTIVE",
    ownerUserId: salesId,
    signerId: salesId,
    attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
    createdById: salesId,
    updatedById: salesId
  };
  // cHigh: 逾期 60 天 + 零回款零开票 → 100*0.3+100*0.25+100*0.2+20*0.15 = 78 HIGH
  // (customer 仅 2 份合同 → 信用维度样本<3 固定 20)
  const cHigh = await prisma.contract.create({
    data: {
      ...base,
      contractNo: `${TAG}-HIGH`,
      title: `${TAG}-高危合同`,
      signDate: new Date(now - 160 * DAY_MS),
      startDate: new Date(now - 160 * DAY_MS),
      endDate: new Date(now - 60 * DAY_MS)
    }
  });
  cHighId = cHigh.id;
  // cLow: 新签健康合同 → LOW
  const cLow = await prisma.contract.create({
    data: {
      ...base,
      contractNo: `${TAG}-LOW`,
      title: `${TAG}-健康合同`,
      signDate: new Date(now - 5 * DAY_MS),
      startDate: new Date(now - 5 * DAY_MS),
      endDate: new Date(now + 85 * DAY_MS)
    }
  });
  cLowId = cLow.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    const ids = [cHighId, cLowId].filter((x): x is string => !!x);
    await prisma.riskScoreSnapshot.deleteMany({ where: { contractId: { in: ids } } });
    // 清理本测试产生的消息: entityKey 含测试合同 id, 或本次运行窗口内的 RISK_LEVEL_UP (含 SUMMARY)
    await prisma.message.deleteMany({
      where: {
        OR: [
          ...ids.map((id) => ({ entityKey: { contains: id } })),
          { type: "RISK_LEVEL_UP", createdAt: { gte: testStart } }
        ]
      }
    });
    if (ids.length > 0) await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    // 清理本组专用 SALES 用户
    if (salesId) await prisma.user.delete({ where: { id: salesId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

describe("risk-score-snapshot job", () => {
  it("写今日快照 + 幂等 (跑两遍行数不变)", async () => {
    if (!dbReachable) return;
    const r1 = await runRiskScoreSnapshot();
    expect(r1.scanned).toBeGreaterThan(0);
    const c1 = await prisma.riskScoreSnapshot.findMany({ where: { contractId: cHighId! } });
    expect(c1.length).toBe(1);
    expect(c1[0]!.level).toBe("HIGH");
    expect(c1[0]!.score).toBe(78);

    await runRiskScoreSnapshot();
    const c2 = await prisma.riskScoreSnapshot.findMany({ where: { contractId: cHighId! } });
    expect(c2.length).toBe(1);
  });

  it("昨日 LOW → 今日 HIGH 发升档消息给 owner, 同日重跑不重复", async () => {
    if (!dbReachable) return;
    // 手工种一条昨日 LOW 快照 (today 快照已在上一用例写入, 先删掉让 job 重算)
    await prisma.riskScoreSnapshot.deleteMany({ where: { contractId: cHighId! } });
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    await prisma.riskScoreSnapshot.create({
      data: {
        contractId: cHighId!,
        score: 10,
        level: "LOW",
        dimensions: {},
        snapshotDate: yesterday
      }
    });

    await runRiskScoreSnapshot();
    const msgs = await prisma.message.findMany({
      where: { type: "RISK_LEVEL_UP", entityKey: { contains: cHighId! } }
    });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.some((m) => m.receiverUserId === salesId)).toBe(true);
    expect(msgs[0]!.title).toContain("风险等级上调");

    // 同日重跑: entityKey 带日期, skipDuplicates 兜底 → 不新增
    await runRiskScoreSnapshot();
    const msgs2 = await prisma.message.findMany({
      where: { type: "RISK_LEVEL_UP", entityKey: { contains: cHighId! } }
    });
    expect(msgs2.length).toBe(msgs.length);
  });

  it("低分合同只写快照不发消息", async () => {
    if (!dbReachable) return;
    const snap = await prisma.riskScoreSnapshot.findMany({ where: { contractId: cLowId! } });
    expect(snap.length).toBeGreaterThan(0);
    expect(snap[0]!.level).toBe("LOW");
    const msgs = await prisma.message.findMany({
      where: { type: "RISK_LEVEL_UP", entityKey: { contains: cLowId! } }
    });
    expect(msgs.length).toBe(0);
  });

  it("admin 当日汇总消息按日去重", async () => {
    if (!dbReachable) return;
    const summaries = await prisma.message.findMany({
      where: { type: "RISK_LEVEL_UP", entityKey: { contains: "SUMMARY" }, createdAt: { gte: testStart } }
    });
    // 每个 admin 恰好一条 (cHigh 是 HIGH → 汇总必发; 多 admin 每人一条)
    const receivers = new Set(summaries.map((m) => m.receiverUserId));
    expect(summaries.length).toBe(receivers.size);
    expect(summaries.length).toBeGreaterThan(0);
  });
});

describe("getMyRisks / getMyStats.risk", () => {
  it("getMyRisks 只含本人 MEDIUM+, 降序", async () => {
    if (!dbReachable || !salesUser) return;
    const risks = await getMyRisks(salesUser);
    const mine = risks.find((r) => r.contractId === cHighId);
    expect(mine).toBeDefined();
    expect(mine!.level).toBe("HIGH");
    expect(risks.some((r) => r.contractId === cLowId)).toBe(false);
    for (let i = 1; i < risks.length; i++) {
      expect(risks[i - 1]!.score).toBeGreaterThanOrEqual(risks[i]!.score);
    }
  });

  it("getMyStats.risk 计入 HIGH/CRITICAL", async () => {
    if (!dbReachable || !salesUser) return;
    const s = await getMyStats(salesUser);
    expect(s.risk).toBeGreaterThanOrEqual(1);
  });
});

describe("getContractRisk 单合同详情", () => {
  it("返回 score/level/trend/recommendations/weightedScore (Phase 4a 报告契约)", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await getContractRisk(salesUser, cHighId!);
    expect(r).not.toBeNull();
    expect(r!.level).toBe("HIGH");
    expect(r!.score).toBe(78);
    expect(r!.dimensions.expiry.detail).toContain("已逾期 60 天");
    // Phase 4a: 建议升级为多条 (维度 ≥50 各一条 + 趋势建议), 内容带业务数据
    expect(r!.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(r!.recommendations.some((x) => x.includes("催款"))).toBe(true);
    expect(r!.recommendations.some((x) => x.includes("强关"))).toBe(true);
    // weightedScore 公式串 (spec §7.2 契约)
    expect(r!.weightedScore).toMatch(/^100×0\.30 \+ 100×0\.25 \+ 100×0\.20 \+ 20×0\.15 \+ 0×0\.10 = 78 → 四舍五入 78$/);
    expect(r!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r!.trend.length).toBeGreaterThan(0); // 前面用例已写今日快照
  });

  it("不存在的合同返回 null (路由转 404)", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await getContractRisk(salesUser, "nonexistent-id");
    expect(r).toBeNull();
  });
});
