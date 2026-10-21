// ai-client 统一调用入口单测
// mock global fetch + prisma (缓存表/日志表), 覆盖:
//   - cacheKey 稳定性 (对象 key 书写顺序无关)
//   - 缓存命中: 不调 fetch, hitCount++, 写 cacheHit=true 日志
//   - usage 缺失时 tokens 记 0, 成本记 0
//   - 失败 (网络异常 / HTTP 错误 / 解析失败) 写 FAILURE 日志
//   - force=true 跳过缓存读取但仍写新缓存
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

const db = vi.hoisted(() => ({
  cacheRow: null as {
    id: string;
    cacheKey: string;
    feature: string;
    response: unknown;
    hitCount: number;
    expiresAt: Date;
    createdAt: Date;
  } | null,
  findUniqueCalls: 0,
  updateCalls: 0,
  upsertCalls: 0,
  /** true 时 aiUsageLog.create 抛错, 验证"日志写库失败不阻塞主流程" */
  createFails: false,
  logs: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiResponseCache: {
      findUnique: async () => {
        db.findUniqueCalls += 1;
        return db.cacheRow;
      },
      update: async () => {
        db.updateCalls += 1;
        return {};
      },
      upsert: async () => {
        db.upsertCalls += 1;
        return {};
      }
    },
    aiUsageLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (db.createFails) throw new Error("db down");
        db.logs.push(args.data);
        return {};
      }
    }
  }
}));

import {
  AI_FEATURE,
  callAiChat,
  computeCacheKey,
  estimateCostUsd,
  normalizePayload
} from "@/server/services/ai-client";

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

function callOnce(overrides?: { force?: boolean; payload?: unknown }) {
  return callAiChat({
    feature: AI_FEATURE.CONTRACT_RISK_ANALYSIS,
    userId: "u1",
    payload: overrides?.payload ?? { contractNo: "QT-2026-001" },
    messages: [{ role: "user", content: "分析" }],
    parse: (c) => JSON.parse(c) as { summary: string },
    force: overrides?.force
  });
}

beforeEach(() => {
  db.cacheRow = null;
  db.findUniqueCalls = 0;
  db.updateCalls = 0;
  db.upsertCalls = 0;
  db.createFails = false;
  db.logs = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeCacheKey / normalizePayload", () => {
  it("对象 key 书写顺序无关 (递归排序)", () => {
    const a = { x: 1, y: { b: 2, a: [3, { d: 4, c: 5 }] } };
    const b = { y: { a: [3, { c: 5, d: 4 }], b: 2 }, x: 1 };
    expect(JSON.stringify(normalizePayload(a))).toBe(JSON.stringify(normalizePayload(b)));
    expect(computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "m", a)).toBe(
      computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "m", b)
    );
  });

  it("payload / model / feature 任一不同 → key 不同", () => {
    const base = computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "m", { a: 1 });
    expect(computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "m", { a: 2 })).not.toBe(base);
    expect(computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "m2", { a: 1 })).not.toBe(base);
  });
});

describe("estimateCostUsd", () => {
  it("按刊例单价估算 (1M 输入 + 1M 输出 = 0.27 + 1.10)", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(1.37, 6);
  });
  it("tokens 为 0 → 成本 0", () => {
    expect(estimateCostUsd(0, 0)).toBe(0);
  });
});

describe("callAiChat 缓存行为", () => {
  it("缓存未命中 → 调 fetch + 写缓存 + 写 SUCCESS 日志", async () => {
    const fn = mockFetchOnce(200, {
      choices: [{ message: { content: '{"summary":"s"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 }
    });
    const r = await callOnce();
    expect(r.cached).toBe(false);
    expect(r.result).toEqual({ summary: "s" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.upsertCalls).toBe(1);
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      status: "SUCCESS",
      cacheHit: false,
      promptTokens: 100,
      completionTokens: 50,
      userId: "u1",
      model: "deepseek-chat"
    });
    expect(db.logs[0]!.costEstimate).toBeCloseTo(estimateCostUsd(100, 50), 6);
  });

  it("缓存命中 (未过期) → 不调 fetch, hitCount++, 日志 cacheHit=true/tokens=0", async () => {
    const fn = mockFetchOnce(200, {});
    db.cacheRow = {
      id: "c1",
      cacheKey: computeCacheKey(AI_FEATURE.CONTRACT_RISK_ANALYSIS, "deepseek-chat", { contractNo: "QT-2026-001" }),
      feature: AI_FEATURE.CONTRACT_RISK_ANALYSIS,
      response: { summary: "缓存的摘要" },
      hitCount: 3,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date("2026-10-20T08:00:00.000Z")
    };
    const r = await callOnce();
    expect(r.cached).toBe(true);
    expect(r.result).toEqual({ summary: "缓存的摘要" });
    // generatedAt 取缓存条目生成时间
    expect(r.generatedAt).toBe("2026-10-20T08:00:00.000Z");
    expect(fn).not.toHaveBeenCalled();
    expect(db.updateCalls).toBe(1);
    expect(db.upsertCalls).toBe(0);
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      status: "SUCCESS",
      cacheHit: true,
      promptTokens: 0,
      completionTokens: 0,
      costEstimate: null,
      latencyMs: 0
    });
  });

  it("缓存已过期 → 视为未命中, 重新调 fetch", async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{"summary":"新"}' } }] });
    db.cacheRow = {
      id: "c1",
      cacheKey: "k",
      feature: AI_FEATURE.CONTRACT_RISK_ANALYSIS,
      response: { summary: "旧" },
      hitCount: 0,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date()
    };
    const r = await callOnce();
    expect(r.cached).toBe(false);
    expect(r.result).toEqual({ summary: "新" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("force=true → 跳过缓存读取, 但仍写新缓存与日志", async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{"summary":"强制"}' } }] });
    db.cacheRow = {
      id: "c1",
      cacheKey: "k",
      feature: AI_FEATURE.CONTRACT_RISK_ANALYSIS,
      response: { summary: "旧" },
      hitCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date()
    };
    const r = await callOnce({ force: true });
    expect(r.cached).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.findUniqueCalls).toBe(0);
    expect(db.upsertCalls).toBe(1);
    expect(db.logs[0]).toMatchObject({ cacheHit: false, status: "SUCCESS" });
  });
});

describe("callAiChat 日志与异常", () => {
  it("usage 缺失 → tokens 记 0, 成本记 0", async () => {
    mockFetchOnce(200, { choices: [{ message: { content: '{"summary":"s"}' } }] });
    await callOnce();
    expect(db.logs[0]).toMatchObject({ promptTokens: 0, completionTokens: 0, costEstimate: 0 });
  });

  it("网络异常 → 502 + FAILURE 日志", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(callOnce()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("请求失败") });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({ status: "FAILURE", cacheHit: false });
    expect(String(db.logs[0]!.errorMessage)).toContain("请求失败");
  });

  it("HTTP 500 → FAILURE 日志", async () => {
    mockFetchOnce(500, {});
    await expect(callOnce()).rejects.toMatchObject({ status: 502 });
    expect(db.logs[0]).toMatchObject({ status: "FAILURE" });
    expect(String(db.logs[0]!.errorMessage)).toContain("HTTP 500");
  });

  it("解析失败 → 502 + FAILURE 日志", async () => {
    mockFetchOnce(200, { choices: [{ message: { content: "not json" } }] });
    await expect(callOnce()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("解析失败") });
    expect(db.logs[0]).toMatchObject({ status: "FAILURE" });
  });

  it("日志写库失败只 warn 不阻塞主流程", async () => {
    mockFetchOnce(200, { choices: [{ message: { content: '{"summary":"s"}' } }] });
    db.createFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = await callOnce();
      expect(r.result).toEqual({ summary: "s" });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
