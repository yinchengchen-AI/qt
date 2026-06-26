// 登记回款 ProFormDatePicker 入口兼容性的回归测试
// 之前 app/(app)/payments/new/page.tsx 用 `new Date(values.receivedAt).toISOString()` 三元
// 表达式把 dayjs 输入转 ISO 字符串,在 dayjs 不可用或 picker 失活时会得到 undefined,
// 后端 z.iso.datetime() 抛 "receivedAt: expected string, received undefined"。
//
// 这层测试锁住 lib/format.toIsoDateTime 的多入口契约:Date | dayjs | moment | string
// 必须一致产出 Z 后缀 ISO,空值 / 无效值必须降级为 undefined。
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { toIsoDateTime } from "@/lib/format";

describe("toIsoDateTime — 多入口 ISO 转换", () => {
  it("dayjs 实例 → Z 后缀 ISO(锁住 ProFormDatePicker 入口)", () => {
    const d = dayjs("2026-01-15T08:00:00.000Z");
    expect(toIsoDateTime(d)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("Date 实例 → Z 后缀 ISO", () => {
    const d = new Date("2026-01-15T08:00:00.000Z");
    expect(toIsoDateTime(d)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("纯 YYYY-MM-DD 字符串 → 归一为 ISO 字符串", () => {
    expect(toIsoDateTime("2026-01-15")).toBe("2026-01-15T00:00:00.000Z");
  });

  it("已带 Z 的 ISO 字符串 → 透传", () => {
    expect(toIsoDateTime("2026-01-15T08:00:00.000Z")).toBe(
      "2026-01-15T08:00:00.000Z"
    );
  });

  it("带时区偏移的 ISO 字符串 → 归一为 UTC Z 后缀", () => {
    // 无论源字符串时区是什么,输出必须统一 UTC,后端 z.iso.datetime() 才能稳定通过
    expect(toIsoDateTime("2026-01-15T16:00:00+08:00")).toBe(
      "2026-01-15T08:00:00.000Z"
    );
  });

  it("空值 / null / undefined / 空串 → undefined(配合 .optional() / .default())", () => {
    expect(toIsoDateTime(undefined)).toBeUndefined();
    expect(toIsoDateTime(null)).toBeUndefined();
    expect(toIsoDateTime("")).toBeUndefined();
  });

  it("无效 Date 不会抛,降级为 undefined", () => {
    expect(toIsoDateTime(new Date("not-a-date"))).toBeUndefined();
    expect(toIsoDateTime("garbage")).toBeUndefined();
  });

  it("moment 风格对象(toDate() 返回有效 Date)→ ISO 字符串", () => {
    const fakeMoment = {
      toDate: () => new Date("2026-01-15T08:00:00.000Z")
    };
    expect(toIsoDateTime(fakeMoment)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("既不是 Date 也不是字符串,也没有 toDate 的怪异对象 → undefined", () => {
    expect(toIsoDateTime({})).toBeUndefined();
    expect(toIsoDateTime(42)).toBeUndefined();
    expect(toIsoDateTime(true)).toBeUndefined();
  });
});
