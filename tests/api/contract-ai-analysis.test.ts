// /api/contracts/[id]/ai-analysis 路由测试 (Phase 4b)
//
// 覆盖:
//   1) 合同不存在 → 404 (getContractRisk 返回 null)
//   2) 成功路径 → 200, 响应 { summary, talkTracks, model, generatedAt }
//   3) 服务降级 (无 key) → 503
//
// 薄壳路由: mock session + workbench.getContractRisk + contract-ai.analyzeContractRisk,
// 只验证路由的组装与错误透传 (业务逻辑在 service 单测覆盖).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/session";

const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new Error("no actor injected");
      return sessionHolder.actor;
    }
  };
});

const riskHolder = vi.hoisted(() => ({ detail: null as unknown }));
vi.mock("@/server/services/contract/workbench", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/contract/workbench")>();
  return {
    ...mod,
    getContractRisk: async () => riskHolder.detail
  };
});

const aiHolder = vi.hoisted(() => ({
  result: { summary: "摘要", talkTracks: ["话术"], model: "deepseek-chat", cached: false, generatedAt: "2026-08-19T00:00:00.000Z" } as unknown,
  error: null as Error | null,
  lastOpts: undefined as { userId?: string; force?: boolean } | undefined
}));
vi.mock("@/server/services/contract-ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/contract-ai")>();
  return {
    ...mod,
    analyzeContractRisk: async (_report: unknown, _context: unknown, opts?: { userId?: string; force?: boolean }) => {
      aiHolder.lastOpts = opts;
      if (aiHolder.error) throw aiHolder.error;
      return aiHolder.result;
    }
  };
});

import { GET } from "@/app/api/contracts/[id]/ai-analysis/route";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const ACTOR: SessionUser = { id: "u1", employeeNo: "u1", name: "u1", email: "u1@t.local", roleCode: "SALES", permissions: [] };

function makeDetail() {
  return {
    contractId: "c1",
    contractNo: "QT-2026-001",
    customerName: "测试客户",
    title: "测试合同",
    score: 78,
    level: "HIGH",
    asOf: "2026-08-19",
    dimensions: {},
    weightedScore: "w",
    recommendations: ["催款"],
    trendSummary: null,
    totalAmount: 100000,
    paidAmount: 0,
    invoicedAmount: 0,
    daysOverdue: 60,
    trend: []
  };
}

function call(id: string, qs = "") {
  return GET(new Request(`http://localhost/api/contracts/${id}/ai-analysis${qs}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  sessionHolder.actor = ACTOR;
  riskHolder.detail = null;
  aiHolder.error = null;
  aiHolder.lastOpts = undefined;
  aiHolder.result = { summary: "摘要", talkTracks: ["话术"], model: "deepseek-chat", cached: false, generatedAt: "2026-08-19T00:00:00.000Z" };
});

describe("GET /api/contracts/[id]/ai-analysis", () => {
  it("合同不存在 → 404", async () => {
    const res = await call("nonexistent");
    expect(res.status).toBe(404);
    const j = await res.json();
    expect(j.errorCode).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("成功 → 200 + AI 分析结构", async () => {
    riskHolder.detail = makeDetail();
    const res = await call("c1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data.summary).toBe("摘要");
    expect(j.data.talkTracks).toEqual(["话术"]);
    expect(j.data.model).toBe("deepseek-chat");
  });

  it("服务降级 (无 key 503) → 503 透传", async () => {
    riskHolder.detail = makeDetail();
    aiHolder.error = new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 分析未配置 (DEEPSEEK_API_KEY 未设置)", 503);
    const res = await call("c1");
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.message).toContain("未配置");
  });

  it("透传 userId 与 cached 字段; 默认不 force", async () => {
    riskHolder.detail = makeDetail();
    aiHolder.result = { summary: "s", talkTracks: ["t"], model: "deepseek-chat", cached: true, generatedAt: "2026-10-20T00:00:00.000Z" };
    const res = await call("c1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.cached).toBe(true);
    expect(aiHolder.lastOpts?.userId).toBe(ACTOR.id);
    expect(aiHolder.lastOpts?.force).toBe(false);
  });

  it("?force=1 → 透传 force=true (跳过缓存读取)", async () => {
    riskHolder.detail = makeDetail();
    const res = await call("c1", "?force=1");
    expect(res.status).toBe(200);
    expect(aiHolder.lastOpts?.force).toBe(true);
  });
});
