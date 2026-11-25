import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/session";
import { collectBusinessReportData } from "@/server/services/business-report-data";
import { getInvoiceAging, getOverview, getTimeSeries } from "@/server/services/statistics";
import {
  agingResultFixture,
  businessReportDataFixture,
  overviewFixture,
  reportRange,
  seriesFixture
} from "@/tests/fixtures/business-report";

vi.mock("@/server/services/statistics", () => ({
  getOverview: vi.fn(),
  getInvoiceAging: vi.fn(),
  getTimeSeries: vi.fn()
}));

beforeEach(() => {
  vi.mocked(getOverview).mockResolvedValue(overviewFixture);
  vi.mocked(getTimeSeries).mockResolvedValue(seriesFixture);
  vi.mocked(getInvoiceAging).mockResolvedValue(agingResultFixture);
});

describe("collectBusinessReportData", () => {
  it("复用统计 Service 并排除发票号和明细分组", async () => {
    const user = { id: "sales-1", roleCode: "SALES" } as SessionUser;
    const result = await collectBusinessReportData(user, reportRange);

    expect(getOverview).toHaveBeenCalledWith(user, reportRange);
    expect(getTimeSeries).toHaveBeenCalledWith(user, reportRange);
    expect(getInvoiceAging).toHaveBeenCalledWith(user, {
      basis: "due",
      page: 1,
      pageSize: 1,
      sort: "daysOverdue:desc"
    });
    expect(result).toEqual(businessReportDataFixture);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-001");
    expect(JSON.stringify(result)).not.toContain("i-private");
  });
});
