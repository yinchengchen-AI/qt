import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";
import { ERROR_CODES } from "@/types/errors";
import { GET } from "@/app/api/statistics/ai-report/route";
import { collectBusinessReportData } from "@/server/services/business-report-data";
import { generateBusinessReport } from "@/server/services/ai-report-generation";
import { businessReportDataFixture as reportData, localReportFixture } from "@/tests/fixtures/business-report";

const salesUser: SessionUser = {
  id: "sales-1",
  employeeNo: "sales",
  name: "销售",
  email: "sales@test.local",
  roleCode: "SALES",
  permissions: []
};

const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));

vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      return sessionHolder.actor;
    }
  };
});

vi.mock("@/server/services/business-report-data", () => ({
  collectBusinessReportData: vi.fn()
}));

vi.mock("@/server/services/ai-report-generation", () => ({
  generateBusinessReport: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionHolder.actor = salesUser;
  vi.mocked(collectBusinessReportData).mockResolvedValue(reportData);
  vi.mocked(generateBusinessReport).mockResolvedValue(localReportFixture);
});

describe("GET /api/statistics/ai-report", () => {
  it("把登录用户和角色写入缓存范围", async () => {
    const response = await GET(new Request("http://localhost/api/statistics/ai-report?range=quarter&force=1"));
    expect(response.status).toBe(200);
    expect(generateBusinessReport).toHaveBeenCalledWith(reportData, {
      userId: salesUser.id,
      cacheScope: `${salesUser.id}:${salesUser.roleCode}`,
      force: true
    });
    const body = await response.json();
    expect(body).toEqual({ code: 0, data: localReportFixture });
  });

  it("未登录返回 401, 不调用收集器或模型", async () => {
    sessionHolder.actor = null;
    const response = await GET(new Request("http://localhost/api/statistics/ai-report"));
    expect(response.status).toBe(401);
    expect(collectBusinessReportData).not.toHaveBeenCalled();
    expect(generateBusinessReport).not.toHaveBeenCalled();
  });

  it("自定义 from/to 透传为 DateRange", async () => {
    const from = "2026-09-01T00:00:00.000Z";
    const to = "2026-09-30T23:59:59.999Z";
    await GET(new Request(`http://localhost/api/statistics/ai-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    expect(collectBusinessReportData).toHaveBeenCalledWith(salesUser, {
      from: new Date(from),
      to: new Date(to)
    });
  });

  it("非法日期返回 400, 不调用收集器", async () => {
    const response = await GET(new Request("http://localhost/api/statistics/ai-report?from=not-a-date"));
    expect(response.status).toBe(400);
    expect(collectBusinessReportData).not.toHaveBeenCalled();
  });
});
