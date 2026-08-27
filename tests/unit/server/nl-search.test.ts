// 自然语言搜索接线单测 (纯函数, 不触库)
//   1) extractResidualKeyword: 剥离时间/金额/状态/类别/语气词后的残余关键词
//   2) buildNlPlan: 结构化条件命中时生成各类别 where + 回显; 无结构化条件返回 null
//   3) 状态词不套用到发票/回款 (值域是合同状态); 残余关键词经 LIKE 转义
import { describe, it, expect } from "vitest";
import { extractResidualKeyword } from "@/server/services/natural-language-search";
import { buildNlPlan } from "@/server/services/search";

describe("extractResidualKeyword 残余关键词提取", () => {
  it("纯结构化查询无残余", () => {
    expect(extractResidualKeyword("找去年Q3的合同")).toBe("");
    expect(extractResidualKeyword("本月大额合同")).toBe("");
    expect(extractResidualKeyword("本月活跃合同")).toBe("");
  });

  it("保留业务关键词", () => {
    expect(extractResidualKeyword("本月企泰的合同")).toBe("企泰");
    expect(extractResidualKeyword("去年Q3的企泰合同")).toBe("企泰");
    expect(extractResidualKeyword("上月企泰客户的回款")).toBe("企泰");
  });

  it("不剥离品牌名里的'的'", () => {
    // "的" 只在紧贴类别词时剥离: "美的集团的合同" → "美的集团"
    expect(extractResidualKeyword("美的集团的合同")).toBe("美的集团");
  });

  it("剥离语气词", () => {
    expect(extractResidualKeyword("帮我查一下本月所有合同")).toBe("");
  });
});

describe("buildNlPlan 自然语言检索计划", () => {
  it("无结构化条件返回 null (走纯关键词路径)", () => {
    expect(buildNlPlan("企泰客户")).toBeNull();
    expect(buildNlPlan("HT-2026-001")).toBeNull();
    // 只有类别词没有结构化条件 → 不启用 NL (保持全局分组检索行为)
    expect(buildNlPlan("企泰合同")).toBeNull();
  });

  it("时间+金额+类别: 只查合同组, where 含 startDate 区间与 totalAmount", () => {
    const plan = buildNlPlan("本月大额合同");
    expect(plan).not.toBeNull();
    expect(plan!.echo.category).toBe("contract");
    expect(plan!.echo.timeLabel).toBe("本月");
    expect(plan!.echo.amountLabel).toBe("10万-100万");
    expect(plan!.echo.keyword).toBeUndefined();
    const where = plan!.wheres.contract as Record<string, unknown>;
    expect(where.deletedAt).toBeNull();
    expect(where.startDate).toBeDefined();
    expect(where.totalAmount).toBeDefined();
    // 未纳入计划的组不生成 where
    expect(plan!.wheres.customer).toBeUndefined();
    expect(plan!.wheres.invoice).toBeUndefined();
    expect(plan!.wheres.payment).toBeUndefined();
  });

  it("残余关键词进入 OR 条件", () => {
    const plan = buildNlPlan("去年Q3的企泰合同");
    expect(plan).not.toBeNull();
    expect(plan!.echo.keyword).toBe("企泰");
    const where = plan!.wheres.contract as Record<string, unknown>;
    expect(JSON.stringify(where.OR)).toContain("企泰");
    // 合同时间口径: startDate 落在区间内 (gte+lte 同一字段)
    const startDate = where.startDate as { gte: Date; lte: Date };
    expect(startDate.gte).toBeInstanceOf(Date);
    expect(startDate.lte).toBeInstanceOf(Date);
  });

  it("状态词不套用到发票/回款类别 (合同状态值域)", () => {
    const plan = buildNlPlan("本月活跃发票");
    expect(plan).not.toBeNull();
    expect(plan!.echo.category).toBe("invoice");
    const where = plan!.wheres.invoice as Record<string, unknown>;
    expect("status" in where).toBe(false);
    expect(where.applyDate).toBeDefined();
  });

  it("残余关键词中的 LIKE 通配符被转义", () => {
    const plan = buildNlPlan("本月 企_泰 合同");
    expect(plan).not.toBeNull();
    expect(plan!.echo.keyword).toBe("企_泰"); // 回显原始词
    const where = plan!.wheres.contract as { OR?: Array<{ OR: Array<{ title?: { contains: string } }> }> };
    // where 里的 contains 值带转义反斜杠 (企\_泰), 直接断值不走 JSON 字符串比较
    expect(where.OR?.[0]?.OR?.[0]?.title?.contains).toBe("企\\_泰");
  });

  it("无类别时四组都生成 where", () => {
    const plan = buildNlPlan("本月大额");
    expect(plan).not.toBeNull();
    expect(plan!.wheres.customer).toBeDefined();
    expect(plan!.wheres.contract).toBeDefined();
    expect(plan!.wheres.invoice).toBeDefined();
    expect(plan!.wheres.payment).toBeDefined();
  });
});
