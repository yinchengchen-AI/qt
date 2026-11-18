import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { SessionUser } from "@/lib/session";
import type { AgingResult } from "@/server/services/statistics";
import { GET } from "@/app/api/statistics/export/route";

const getInvoiceAgingMock = vi.hoisted(() => vi.fn());
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new Error("test actor missing");
      return sessionHolder.actor;
    }
  };
});

vi.mock("@/server/services/statistics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/statistics")>();
  return { ...actual, getInvoiceAging: getInvoiceAgingMock };
});

const agingResult: AgingResult = {
  buckets: { "0-30": 1250, "31-60": 0, "61-90": 0, "90+": 0 },
  total: 1,
  rows: [
    {
      invoiceId: "invoice-1",
      invoiceNo: "INV-2026-001",
      customerId: "customer-1",
      customerName: "测试客户",
      contractId: "contract-1",
      contractNo: "HT-2026-001",
      ownerUserId: "owner-1",
      ownerName: "测试业务员",
      daysOverdue: 15,
      remaining: 1250,
      bucket: "0-30",
      status: "ISSUED",
      basisUsed: "due"
    }
  ],
  summary: {
    totalReceivable: 1250,
    over90Amount: 0,
    over90Ratio: 0,
    largestInvoice: { invoiceId: "invoice-1", invoiceNo: "INV-2026-001", remaining: 1250 },
    customerCount: 1,
    ownerCount: 1,
    dataQualityExcludedAmount: 0,
    dataQualityExcludedInvoiceCount: 0
  },
  byCustomer: [],
  byOwner: [],
  pagination: { page: 1, pageSize: 5000, total: 1, totalPages: 1 },
  basisUsed: "due",
  dataQualityExcluded: { amount: 0, invoiceCount: 0, byCode: {} }
};

describe("账龄 Excel 导出", () => {
  beforeEach(() => {
    sessionHolder.actor = {
      id: "finance-1",
      employeeNo: "finance",
      name: "财务",
      email: "finance@example.com",
      roleCode: "FINANCE",
      permissions: []
    };
    getInvoiceAgingMock.mockReset();
    getInvoiceAgingMock.mockResolvedValue(agingResult);
  });

  it("保留账龄字段且不包含催收列", async () => {
    const response = await GET(new Request("http://localhost/api/statistics/export?type=aging&basis=due"));
    if (!response) throw new Error("expected aging export response");
    expect(response.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await response.arrayBuffer());
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    const worksheet = workbook.getWorksheet("Sheet1");
    expect(worksheet).toBeDefined();

    const headerRow = worksheet!.getRow(1);
    const headers = Array.from(
      { length: worksheet!.columnCount },
      (_, index) => String(headerRow.getCell(index + 1).text ?? "")
    );
    expect(headers).not.toContain("已有催收");
    expect(headers).not.toContain("最新催收状态");
    expect(headers).toEqual(expect.arrayContaining(["发票号", "客户", "合同号", "剩余未收", "基准"]));
  });
});
