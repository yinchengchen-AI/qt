// 锁住前端 KNOWN_KEYS 白名单, 防止以后误删导致某个过滤条件在列表里"看起来在筛, 实际没发出去".
// 客户列表最近一次回归就是这个: customerType 被吞, 列表和导出都按不了类型筛.
import { describe, it, expect } from "vitest";
import { KNOWN_KEYS } from "@/lib/use-list-request";

describe("use-list-request KNOWN_KEYS 白名单", () => {
  it("包含所有 list 路由实际支持的过滤键 (keyword/status/scale/customerType/...ID)", () => {
    // 任何新条件: 先确认 list 路由的 zod schema + service 都认, 再加进这个集合 + 这个测试里
    const expected = [
      "keyword",
      "status",
      "scale",
      "customerType",
      "industry",
      "province",
      "city",
      "district",
      "town",
      "ownerUserId",
      "createdAtFrom",
      "createdAtTo",
      "customerId",
      "contractId",
      "invoiceId",
    ];
    for (const k of expected) {
      expect(KNOWN_KEYS.has(k), `KNOWN_KEYS 应包含 ${k}`).toBe(true);
    }
  });

  it("customerType 必须在白名单 (历史回归: 被误删后列表/导出都不过滤类型)", () => {
    expect(KNOWN_KEYS.has("customerType")).toBe(true);
  });
});
