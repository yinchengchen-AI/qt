// DeepSeek AI 风险分析服务单测 (Phase 4b)
// mock global fetch, 不打真实 API; 覆盖 prompt 结构 / 解析 / 错误映射 / 无 key 降级
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// env 在模块 import 时一次性求值 (t3-env), 必须在被测模块加载前注入测试 key,
// 否则 CI (无 .env) 下所有用例都会走"未配置 503"分支; vi.hoisted 保证先于 import 执行
vi.hoisted(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

import { analyzeContractRisk, parseAiJson } from "@/server/services/contract-ai";
import type { RiskReport } from "@/server/services/contract/risk-report";

const REPORT: RiskReport = {
  contractId: "c1",
  contractNo: "QT-2026-001",
  riskScore: 78,
  riskLevel: "HIGH",
  asOf: "2026-08-19",
  dimensions: {
    expiry: { score: 100, detail: "已逾期 60 天" },
    payment: { score: 100, detail: "时间进度 100%，回款进度 0%" },
    invoicing: { score: 100, detail: "时间进度 100%，开票进度 0%" },
    customerCredit: { score: 20, detail: "客户历史合同仅 1 份（样本不足按 20 分计）" },
    amountAnomaly: { score: 0, detail: "客户合同样本不足，不评估金额偏离" }
  },
  weightedScore: "100×0.30 + 100×0.25 + 100×0.20 + 20×0.15 + 0×0.10 = 78 → 四舍五入 78",
  recommendations: ["付款进度落后最严重：建议立即发起催款（剩余 ¥100,000）"],
  trendSummary: { days: 30, from: 10, to: 78, mainDriver: "expiry" }
};

const CONTEXT = {
  customerName: "测试客户",
  title: "测试合同",
  totalAmount: 100000,
  paidAmount: 0,
  invoicedAmount: 0,
  daysOverdue: 60
};

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAiJson", () => {
  it("解析干净 JSON", () => {
    const r = parseAiJson('{"summary":"摘要","talkTracks":["话术1","话术2"]}');
    expect(r.summary).toBe("摘要");
    expect(r.talkTracks).toEqual(["话术1", "话术2"]);
  });
  it("容忍 ```json 包裹与首尾杂讯", () => {
    const r = parseAiJson('好的,以下是分析:\n```json\n{"summary":"摘要","talkTracks":["话术"]}\n```\n希望有帮助');
    expect(r.summary).toBe("摘要");
    expect(r.talkTracks).toEqual(["话术"]);
  });
  it("缺 summary/talkTracks → 抛错", () => {
    expect(() => parseAiJson('{"summary":"","talkTracks":[]}')).toThrow();
    expect(() => parseAiJson("not json at all")).toThrow();
  });
});

describe("analyzeContractRisk", () => {
  it("成功: 请求结构正确 (model/JSON 格式/报告字段), 返回解析结果", async () => {
    const fn = mockFetchOnce(200, {
      choices: [{ message: { content: '{"summary":"该合同逾期严重","talkTracks":["请尽快回款","建议约谈"]}' } }]
    });
    const r = await analyzeContractRisk(REPORT, CONTEXT);
    expect(r.summary).toBe("该合同逾期严重");
    expect(r.talkTracks).toEqual(["请尽快回款", "建议约谈"]);
    expect(r.model).toBe("deepseek-chat");

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-chat");
    expect(body.response_format).toEqual({ type: "json_object" });
    const userMsg = body.messages[1].content;
    expect(userMsg).toContain("QT-2026-001");
    expect(userMsg).toContain("已逾期 60 天");
    expect(userMsg).toContain("催款");
  });

  it("401 → 鉴权失败 502", async () => {
    mockFetchOnce(401, { error: "unauthorized" });
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("鉴权失败") });
  });

  it("429 → 限流 502", async () => {
    mockFetchOnce(429, {});
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("限流") });
  });

  it("500 → 上游异常 502", async () => {
    mockFetchOnce(500, {});
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("HTTP 500") });
  });

  it("返回空 choices → 502", async () => {
    mockFetchOnce(200, { choices: [] });
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("返回为空") });
  });

  it("LLM 输出非预期 JSON → 解析失败 502", async () => {
    mockFetchOnce(200, { choices: [{ message: { content: "无法分析" } }] });
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("解析失败") });
  });

  it("网络异常/超时 → 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation timed out", "TimeoutError")));
    await expect(analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("请求失败") });
  });

  it("无 DEEPSEEK_API_KEY → 503 明确降级", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.resetModules();
    const mod = await import("@/server/services/contract-ai");
    await expect(mod.analyzeContractRisk(REPORT, CONTEXT)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("未配置") });
  });
});
