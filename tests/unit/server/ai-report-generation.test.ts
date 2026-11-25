import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiResponseCache: {
      findUnique: async () => null,
      update: async () => ({}),
      upsert: async () => ({})
    },
    aiUsageLog: { create: async () => ({}) }
  }
}));

import {
  buildBusinessReportPayload,
  generateBusinessReport,
  generateLLMReport,
  generateLocalSummary
} from "@/server/services/ai-report-generation";
import {
  businessReportDataFixture as fixture,
  reportOptions as options
} from "@/tests/fixtures/business-report";

function aiResponse(report: { summary: string; keyFindings: string[]; recommendations: string[] }) {
  return { choices: [{ message: { content: JSON.stringify(report) } }] };
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("AI 经营报告", () => {
  it("规则摘要使用输入数字并明确 LOCAL", () => {
    const report = generateLocalSummary(fixture, new Date("2026-11-01T00:00:00.000Z"));
    expect(report.source).toBe("LOCAL");
    expect(report.model).toBeNull();
    expect(report.summary).toContain("1000.00");
    expect(report.notice).toBeNull();
  });

  it("AI 成功返回结构化报告, prompt 不含客户或员工姓名", async () => {
    const fetchMock = mockFetchOnce(200, aiResponse({
      summary: "本期合同额 1000 元，回款率 62.5%",
      keyFindings: ["90+ 天应收为 10 元"],
      recommendations: ["优先跟进逾期应收"]
    }));
    const report = await generateLLMReport(fixture, options);
    const [, init] = fetchMock.mock.calls[0]!;
    const prompt = String(init.body);
    expect(prompt).not.toContain("topCustomers");
    expect(prompt).not.toContain("topRanking");
    expect(prompt).not.toContain("PRIVATE-001");
    expect(prompt).not.toContain("i-private");
    expect(report).toMatchObject({ source: "AI", model: "deepseek-chat", cached: false });
  });

  it("同一日历区间仅当前时刻不同仍产生相同缓存 payload", () => {
    const morning = { ...fixture, range: { ...fixture.range, to: new Date("2026-10-31T01:00:00.000Z") } };
    const afternoon = { ...fixture, range: { ...fixture.range, to: new Date("2026-10-31T08:00:00.000Z") } };
    expect(buildBusinessReportPayload(morning)).toEqual(buildBusinessReportPayload(afternoon));
  });

  it("AI 输出输入之外的金额时, 对外服务回退规则摘要", async () => {
    mockFetchOnce(200, aiResponse({ summary: "合同额 999999 元", keyFindings: ["异常"], recommendations: ["复核"] }));
    const report = await generateBusinessReport(fixture, options);
    expect(report.source).toBe("LOCAL");
    expect(report.notice).toBe("AI 解读暂不可用，当前展示规则摘要");
  });

  it.each([
    ["非法 JSON", "not json"],
    ["空发现", JSON.stringify({ summary: "摘要", keyFindings: [], recommendations: ["建议"] })],
    ["超长摘要", JSON.stringify({ summary: "长".repeat(501), keyFindings: ["发现"], recommendations: ["建议"] })]
  ])("%s 时回退 LOCAL", async (_name, content) => {
    mockFetchOnce(200, { choices: [{ message: { content } }] });
    await expect(generateBusinessReport(fixture, options)).resolves.toMatchObject({
      source: "LOCAL",
      notice: "AI 解读暂不可用，当前展示规则摘要"
    });
  });

  it("无 Key 时底层抛 503, 对外服务返回 LOCAL", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.resetModules();
    const mod = await import("@/server/services/ai-report-generation");
    await expect(mod.generateLLMReport(fixture, options)).rejects.toMatchObject({ status: 503 });
    await expect(mod.generateBusinessReport(fixture, options)).resolves.toMatchObject({ source: "LOCAL" });
  });
});
