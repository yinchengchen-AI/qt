import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

describe("import parser (smoke)", () => {
  // 直接用 ExcelJS 写一个最小 xlsx,再过 parseImportFile
  it("parses valid LICENSE rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("LICENSE");
    ws.columns = [
      { header: "name", key: "name", width: 20 },
      { header: "unifiedSocialCreditCode", key: "unifiedSocialCreditCode", width: 20 },
      { header: "legalRepresentative", key: "legalRepresentative", width: 20 },
      { header: "registeredCapital", key: "registeredCapital", width: 20 },
      { header: "establishDate", key: "establishDate", width: 20 },
      { header: "businessScope", key: "businessScope", width: 20 },
      { header: "address", key: "address", width: 20 },
      { header: "tags", key: "tags", width: 20 }
    ];
    ws.addRow({
      name: "测试 1",
      unifiedSocialCreditCode: "91330100MA0000000C",
      legalRepresentative: "A",
      registeredCapital: "100",
      establishDate: "2020-01-01T00:00:00Z",
      businessScope: "X",
      address: "Y",
      tags: "t1,t2"
    });
    ws.addRow({
      name: "",  // 缺 name → 错
      unifiedSocialCreditCode: "INVALID",
      legalRepresentative: "B",
      registeredCapital: "200",
      establishDate: "2021-01-01T00:00:00Z",
      businessScope: "Z",
      address: "W",
      tags: ""
    });
    const buf = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(buf);

    // 动态 import 避免顶部 import 引用 requireSession(需要 session)
    const { parseImportFile } = await import("@/server/services/asset-import");
    // mock user (admin)
    const user = {
      id: "u1", employeeNo: "admin", name: "Admin", email: "a@a", roleCode: "ADMIN" as const,
      permissions: [{ resource: "ASSET" as any, actions: ["CREATE", "READ", "UPDATE", "DELETE"] as any }]
    };
    const result = await parseImportFile(user, "LICENSE", buffer);
    expect(result.type).toBe("LICENSE");
    expect(result.totalRows).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0]?.errors.length).toBe(0);
    expect(result.rows[1]?.errors.length).toBeGreaterThan(0);
  });
});
