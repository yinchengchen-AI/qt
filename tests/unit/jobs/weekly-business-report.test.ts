// 经营周报 job (weekly-business-report) 单测
//
// 覆盖:
//   - 周一运行: ADMIN ∪ FINANCE 并集去重后各收一条 BUSINESS_WEEKLY_REPORT
//   - 同周重跑: entityKey 周幂等, created=0, 消息数不增
//   - 退订用户 (MessagePreference enabled=false) 收不到 (走真实 bus.emit + getDisabledMap)
//   - 无 FINANCE 用户时不报错, 只发 ADMIN
//   - 非周一跳过 (force 可跳过星期判断, 用于手动补跑)
//   - buildWeeklyReportXlsx 产出可被 exceljs 读回的三 sheet xlsx
//
// MinIO 在测试里显式关掉 (isMinioEnabled → false): 附件路径整体跳过,
// 站内信降级为纯文本摘要; xlsx 结构由 buildWeeklyReportXlsx 直接单测覆盖。
import { describe, it, expect, beforeEach, vi } from "vitest";
import ExcelJS from "exceljs";

const mockState = vi.hoisted(() => ({
  users: [] as Array<{ id: string; role: { code: string } }>,
  messages: [] as Array<{
    type: string;
    entityKey: string | null;
    receiverUserId: string;
    title: string;
    content: string;
  }>,
  disabledPrefs: [] as Array<{ userId: string; type: string; enabled: boolean }>,
  overviewCalls: 0
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async (args?: { where?: { role?: { code?: string } } }) => {
        const code = args?.where?.role?.code;
        return mockState.users
          .filter((u) => (code ? u.role.code === code : true))
          .map((u) => ({ id: u.id }));
      })
    },
    message: {
      // job 的周幂等判重
      findFirst: vi.fn(async (args: { where: { type?: string; entityKey?: string } }) => {
        const hit = mockState.messages.find(
          (m) => m.type === args.where.type && m.entityKey === args.where.entityKey
        );
        return hit ? { id: "m-dup" } : null;
      }),
      // bus.emit 写入: 模拟 (entityKey, receiverUserId) 唯一约束 + skipDuplicates
      createMany: vi.fn(async (args: {
        data: Array<{ receiverUserId: string; type: string; title: string; content: string; entityKey: string | null }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of args.data) {
          const dup =
            d.entityKey !== null &&
            mockState.messages.some(
              (m) => m.entityKey === d.entityKey && m.receiverUserId === d.receiverUserId
            );
          if (dup && args.skipDuplicates) continue;
          mockState.messages.push({
            type: d.type,
            entityKey: d.entityKey,
            receiverUserId: d.receiverUserId,
            title: d.title,
            content: d.content
          });
          count++;
        }
        return { count };
      }),
      // bus.emit 推送回拉 (测试不需要广播)
      findMany: vi.fn(async () => [])
    },
    messagePreference: {
      // getDisabledMap: where { userId in, enabled: false }
      findMany: vi.fn(async (args?: { where?: { userId?: { in?: string[] }; enabled?: boolean } }) => {
        const inSet = args?.where?.userId?.in ? new Set(args.where.userId.in) : null;
        return mockState.disabledPrefs
          .filter((p) => p.enabled === false)
          .filter((p) => (inSet ? inSet.has(p.userId) : true))
          .map((p) => ({ userId: p.userId, type: p.type }));
      })
    }
  }
}));

// 统计数据固定化, 不断言数值本身 (数值口径由 statistics 自己的测试覆盖)
vi.mock("@/server/services/statistics", () => ({
  getOverview: vi.fn(async () => {
    mockState.overviewCalls++;
    return {
      contractAmount: 1000,
      invoiceAmount: 800,
      paymentAmount: 500,
      unpaidAmount: 300,
      invoiceRate: 80,
      paymentRate: 62.5,
      contractCount: 2,
      invoiceCount: 3,
      paymentCount: 2
    };
  }),
  getInvoiceAging: vi.fn(async () => ({
    buckets: { "0-30": 100, "31-60": 50, "61-90": 20, "90+": 10 },
    total: 4,
    rows: [],
    summary: {
      totalReceivable: 180,
      over90Amount: 10,
      over90Ratio: 5.56,
      largestInvoice: null,
      customerCount: 2,
      ownerCount: 1,
      dataQualityExcludedAmount: 0,
      dataQualityExcludedInvoiceCount: 0
    },
    byCustomer: [],
    byOwner: [],
    pagination: { page: 1, pageSize: 200, total: 4, totalPages: 1 },
    basisUsed: "due",
    dataQualityExcluded: { amount: 0, invoiceCount: 0, byCode: {} }
  })),
  getPerformanceRanking: vi.fn(async () => [
    {
      rank: 1,
      key: "u-owner",
      name: "张三",
      employeeNo: "E001",
      contractCount: 2,
      contractAmount: 1000,
      invoiceAmount: 800,
      paymentAmount: 500,
      invoiceRate: 80,
      paymentRate: 62.5,
      unpaidAmount: 300
    }
  ])
}));

// 测试环境不连 MinIO: 附件路径整体跳过, 站内信降级纯文本
vi.mock("@/lib/env", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/env")>();
  return { ...orig, isMinioEnabled: () => false };
});

import { runWeeklyBusinessReport, buildWeeklyReportXlsx } from "@/server/jobs/weekly-business-report";
import { isoWeekKey } from "@/server/jobs/contract-renewal-remind";

// 2026-10-19 是周一, 2026-10-20 是周二 (本地时区构造, getDay 与服务器一致)
const MONDAY = new Date("2026-10-19T09:00:00");
const TUESDAY = new Date("2026-10-20T09:00:00");
const EXPECTED_WEEK_KEY = isoWeekKey(new Date("2026-10-12T00:00:00")); // 上周一

beforeEach(() => {
  mockState.users = [
    { id: "u-admin", role: { code: "ADMIN" } },
    { id: "u-finance", role: { code: "FINANCE" } },
    { id: "u-sales", role: { code: "SALES" } }
  ];
  mockState.messages = [];
  mockState.disabledPrefs = [];
  mockState.overviewCalls = 0;
});

describe("runWeeklyBusinessReport", () => {
  it("周一运行: ADMIN ∪ FINANCE 各收一条, SALES 不收", async () => {
    const r = await runWeeklyBusinessReport(MONDAY);
    expect(r.job).toBe("weekly-business-report");
    expect(r.created).toBe(2);
    expect(r.scanned).toBe(2);
    const receivers = mockState.messages.map((m) => m.receiverUserId).sort();
    expect(receivers).toEqual(["u-admin", "u-finance"]);
    const m = mockState.messages[0]!;
    expect(m.type).toBe("BUSINESS_WEEKLY_REPORT");
    expect(m.entityKey).toBe(`BUSINESS_WEEKLY_REPORT:${EXPECTED_WEEK_KEY}`);
    expect(m.title).toBe(`经营周报 ${EXPECTED_WEEK_KEY}`);
    // 纯文本降级 (MinIO 关): content 含降级提示, 含摘要数据
    expect(m.content).toContain("统计区间：2026-10-12 ~ 2026-10-18");
    expect(m.content).toContain("新签合同 2 份");
    expect(m.content).toContain("请到统计页手动导出");
  });

  it("同周重跑: 第二次 created=0, 消息数不增 (entityKey 周幂等)", async () => {
    const r1 = await runWeeklyBusinessReport(MONDAY);
    expect(r1.created).toBe(2);
    const countAfterFirst = mockState.messages.length;
    const r2 = await runWeeklyBusinessReport(MONDAY);
    expect(r2.created).toBe(0);
    expect(mockState.messages.length).toBe(countAfterFirst);
  });

  it("退订用户 (MessagePreference enabled=false) 收不到", async () => {
    mockState.disabledPrefs = [{ userId: "u-finance", type: "BUSINESS_WEEKLY_REPORT", enabled: false }];
    const r = await runWeeklyBusinessReport(MONDAY);
    expect(r.created).toBe(1);
    expect(mockState.messages.map((m) => m.receiverUserId)).toEqual(["u-admin"]);
  });

  it("无 FINANCE 用户不报错, 只发 ADMIN", async () => {
    mockState.users = [{ id: "u-admin", role: { code: "ADMIN" } }];
    const r = await runWeeklyBusinessReport(MONDAY);
    expect(r.created).toBe(1);
    expect(mockState.messages.map((m) => m.receiverUserId)).toEqual(["u-admin"]);
  });

  it("ADMIN/FINANCE 都没有时不报错, 不发消息", async () => {
    mockState.users = [{ id: "u-sales", role: { code: "SALES" } }];
    const r = await runWeeklyBusinessReport(MONDAY);
    expect(r.created).toBe(0);
    expect(mockState.messages).toHaveLength(0);
  });

  it("非周一跳过: 不查统计, 不发消息; force 可手动补跑", async () => {
    const r = await runWeeklyBusinessReport(TUESDAY);
    expect(r.created).toBe(0);
    expect(mockState.messages).toHaveLength(0);
    expect(mockState.overviewCalls).toBe(0);

    const r2 = await runWeeklyBusinessReport(TUESDAY, { force: true });
    expect(r2.created).toBe(2);
    expect(mockState.messages.length).toBe(2);
  });
});

describe("buildWeeklyReportXlsx", () => {
  const asLegacyBuf = (b: Buffer): Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0] =>
    b as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];

  it("产出 业绩总览/账龄摘要/业绩排行 三个 sheet 的有效 xlsx", async () => {
    const buf = await buildWeeklyReportXlsx({
      weekKey: EXPECTED_WEEK_KEY,
      range: { from: new Date("2026-10-12T00:00:00"), to: new Date("2026-10-18T23:59:59.999") },
      overview: {
        contractAmount: 1000,
        invoiceAmount: 800,
        paymentAmount: 500,
        unpaidAmount: 300,
        invoiceRate: 80,
        paymentRate: 62.5,
        contractCount: 2,
        invoiceCount: 3,
        paymentCount: 2
      },
      aging: {
        buckets: { "0-30": 100, "31-60": 50, "61-90": 20, "90+": 10 },
        total: 4,
        rows: [],
        summary: {
          totalReceivable: 180,
          over90Amount: 10,
          over90Ratio: 5.56,
          largestInvoice: null,
          customerCount: 2,
          ownerCount: 1,
          dataQualityExcludedAmount: 0,
          dataQualityExcludedInvoiceCount: 0
        },
        byCustomer: [],
        byOwner: [],
        pagination: { page: 1, pageSize: 200, total: 4, totalPages: 1 },
        basisUsed: "due",
        dataQualityExcluded: { amount: 0, invoiceCount: 0, byCode: {} }
      },
      ranking: [
        {
          rank: 1,
          key: "u-owner",
          name: "张三",
          employeeNo: "E001",
          contractCount: 2,
          contractAmount: 1000,
          invoiceAmount: 800,
          paymentAmount: 500,
          invoiceRate: 80,
          paymentRate: 62.5,
          unpaidAmount: 300
        }
      ]
    });
    expect(buf).toBeInstanceOf(Buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asLegacyBuf(buf));

    const ws1 = wb.getWorksheet("业绩总览")!;
    expect(ws1).toBeDefined();
    expect(ws1.getRow(1).getCell(1).value).toBe("指标");
    expect(ws1.getRow(2).getCell(2).value).toBe("2026-10-12 ~ 2026-10-18");

    const ws2 = wb.getWorksheet("账龄摘要")!;
    expect(ws2).toBeDefined();
    expect(ws2.getRow(1).getCell(1).value).toBe("账龄段");
    expect(ws2.getRow(5).getCell(1).value).toBe("90+ 天");

    const ws3 = wb.getWorksheet("业绩排行")!;
    expect(ws3).toBeDefined();
    expect(ws3.getRow(1).getCell(1).value).toBe("名次");
    expect(ws3.getRow(2).getCell(2).value).toBe("张三");
  });
});
