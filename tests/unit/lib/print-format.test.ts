import { describe, expect, it } from "vitest";
import {
  PRINT_EMPTY,
  pfAmount,
  pfDate,
  pfDateTime,
  pfPercent,
  pfPerson,
  pfText,
} from "@/lib/print-format";

describe("lib/print-format", () => {
  it("PRINT_EMPTY 为 em dash", () => {
    expect(PRINT_EMPTY).toBe("—");
  });

  it("pfText: 空值 → —, 其余转字符串", () => {
    expect(pfText(null)).toBe("—");
    expect(pfText(undefined)).toBe("—");
    expect(pfText("")).toBe("—");
    expect(pfText(0)).toBe("0");
    expect(pfText("abc")).toBe("abc");
  });

  it("pfAmount: ¥ + 千分位 + 两位小数", () => {
    expect(pfAmount(1234)).toBe("¥1,234.00");
    expect(pfAmount("1234567.89")).toBe("¥1,234,567.89");
    expect(pfAmount(0)).toBe("¥0.00");
    expect(pfAmount(null)).toBe("—");
    expect(pfAmount(undefined)).toBe("—");
    expect(pfAmount("")).toBe("—");
  });

  it("pfAmount: 兼容 Prisma Decimal 等带 toString 的数值对象", () => {
    const decimalLike = { toString: () => "1234.5" };
    expect(pfAmount(decimalLike)).toBe("¥1,234.50");
  });

  it("pfDate: YYYY-MM-DD, 空或无效 → —", () => {
    expect(pfDate(new Date(2026, 5, 9))).toBe("2026-06-09");
    expect(pfDate(null)).toBe("—");
    expect(pfDate(undefined)).toBe("—");
    expect(pfDate("not-a-date")).toBe("—");
  });

  it("pfDateTime: YYYY-MM-DD HH:mm, 空或无效 → —", () => {
    expect(pfDateTime(new Date(2026, 5, 9, 17, 30))).toBe("2026-06-09 17:30");
    expect(pfDateTime(null)).toBe("—");
    expect(pfDateTime("not-a-date")).toBe("—");
  });

  it("pfPercent: fraction → 百分数字符串", () => {
    expect(pfPercent(0.06)).toBe("6.00%");
    expect(pfPercent(0.3429)).toBe("34.29%");
    expect(pfPercent(0)).toBe("0.00%");
    expect(pfPercent(null)).toBe("—");
  });

  it("pfPerson: 姓名(工号), 空 → —", () => {
    expect(pfPerson({ name: "张三", employeeNo: "EMP001" })).toBe(
      "张三(EMP001)",
    );
    expect(pfPerson(null)).toBe("—");
    expect(pfPerson(undefined)).toBe("—");
  });
});
