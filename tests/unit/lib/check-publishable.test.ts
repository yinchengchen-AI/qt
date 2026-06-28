// DRAFT → ACTIVE 自动发布前置条件判定 (checkPublishable) 单元测试
//
// 复盘 #1: 之前只有 isPublishable(): boolean, 拿不到"缺什么"具体信息,
// admin 想知道为什么 DRAFT 合同没自动发, 只能去翻 contract + attachments;
// 改成返回 {eligible, missing[]} 之后:
//   - tryAutoPublish precondition 用 .eligible (行为不变)
//   - GET /api/contracts/[id]/publish-eligibility 透传给前端, 直接给 admin 列缺什么
//
// 这层测试锁住: 空缺字段全捕获, 数值边界 (totalAmount>0, taxRate>=0),
// 附件非空 (空数组 / null / 字符串都被拒)。
import { describe, it, expect } from "vitest";
import { checkPublishable } from "@/server/services/contract";

const base = {
  customerId: "c1",
  contractNo: "HT-001",
  title: "安全管理咨询",
  serviceType: "OTHER",
  signDate: new Date("2026-01-01"),
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
  totalAmount: 1000,
  taxRate: 0.06,
  ownerUserId: "u1",
  signerId: "u2",
  attachments: [{ id: "a1" }]
} as const;

describe("checkPublishable — 完整字段全过", () => {
  it("全部字段 + 1 附件 → eligible=true, missing=[]", () => {
    const r = checkPublishable({ ...base });
    expect(r.eligible).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe("checkPublishable — 缺字段全捕获 (UI 提示用)", () => {
  it("全部字段都空 → missing 列全 11 项", () => {
    const empty = {
      customerId: "",
      contractNo: "",
      title: "",
      serviceType: "",
      signDate: null,
      startDate: null,
      endDate: null,
      totalAmount: 0,
      taxRate: -1,
      ownerUserId: "",
      signerId: "",
      attachments: []
    };
    const r = checkPublishable(empty);
    expect(r.eligible).toBe(false);
    expect(r.missing.length).toBeGreaterThanOrEqual(11);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/客户/),
        expect.stringMatching(/合同编号/),
        expect.stringMatching(/合同标题/),
        expect.stringMatching(/服务类型/),
        expect.stringMatching(/签订日期/),
        expect.stringMatching(/开始日期/),
        expect.stringMatching(/结束日期/),
        expect.stringMatching(/总额/),
        expect.stringMatching(/税率/),
        expect.stringMatching(/项目负责人/),
        expect.stringMatching(/签订人/),
        expect.stringMatching(/附件/)
      ])
    );
  });

  it("totalAmount=0 / 负数 → 不通过, 提示总额", () => {
    const r1 = checkPublishable({ ...base, totalAmount: 0 });
    expect(r1.eligible).toBe(false);
    expect(r1.missing).toEqual(expect.arrayContaining([expect.stringMatching(/总额/)]));

    const r2 = checkPublishable({ ...base, totalAmount: -100 });
    expect(r2.eligible).toBe(false);
    expect(r2.missing).toEqual(expect.arrayContaining([expect.stringMatching(/总额/)]));
  });

  it("taxRate<0 → 不通过; taxRate=0 边界 → 通过", () => {
    const r1 = checkPublishable({ ...base, taxRate: -0.01 });
    expect(r1.eligible).toBe(false);
    expect(r1.missing).toEqual(expect.arrayContaining([expect.stringMatching(/税率/)]));

    const r2 = checkPublishable({ ...base, taxRate: 0 });
    expect(r2.eligible).toBe(true);
  });

  it("attachments 是空数组 / 非数组 / null → 不通过, 提示附件", () => {
    for (const att of [[], null, "not-array", undefined, 0]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = checkPublishable({ ...base, attachments: att as any });
      expect(r.eligible).toBe(false);
      expect(r.missing).toEqual(expect.arrayContaining([expect.stringMatching(/附件/)]));
    }
  });

  it("Decimal / 字符串 totalAmount 也能正确判断 (Prisma Decimal 通过 .toString 转 number)", () => {
    const decimalLike = { toString: () => "1234.56" } as unknown as number;
    const r = checkPublishable({ ...base, totalAmount: decimalLike });
    expect(r.eligible).toBe(true);
  });
});
