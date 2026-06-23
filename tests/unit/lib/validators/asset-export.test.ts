// 锁住 #1 修复: /api/assets/export 用的是 assetExportQuerySchema (不是 list 的 schema),
// 上限放宽到 10000, 默认 5000. 旧版 list schema pageSize.max(100) 会让导出 400.
import { describe, it, expect } from "vitest";
import {
  assetListQuerySchema,
  assetExportQuerySchema,
} from "@/lib/validators/asset";

describe("assetExportQuerySchema (导出路由专用)", () => {
  it("默认 pageSize = 5000 (单次可批量导出, 与 lib/excel.ts 的 exportMaxRows 默认对齐)", () => {
    const r = assetExportQuerySchema.parse({});
    expect(r.pageSize).toBe(5000);
    expect(r.page).toBe(1);
  });

  it("允许 pageSize=10000 (与其它 export 路由 exportMaxRows 上限对齐)", () => {
    const r = assetExportQuerySchema.parse({ pageSize: "10000" });
    expect(r.pageSize).toBe(10000);
  });

  it("允许 pageSize=1000 (历史下限, 锁住回归)", () => {
    // 默认已抬到 5000, 但 1000 仍允许 (下限), 锁住不能丢
    const r = assetExportQuerySchema.parse({ pageSize: "1000" });
    expect(r.pageSize).toBe(1000);
  });

  it("拒绝 pageSize>10000 (防止单次请求拉百万行 OOM)", () => {
    const r = assetExportQuerySchema.safeParse({ pageSize: "50000" });
    expect(r.success).toBe(false);
  });

  it("拒绝 pageSize<1", () => {
    const r = assetExportQuerySchema.safeParse({ pageSize: "0" });
    expect(r.success).toBe(false);
  });

  it("透传列表的过滤条件 (type/status/q/tags/...)", () => {
    const r = assetExportQuerySchema.parse({
      type: "LICENSE",
      status: "VALID",
      q: "iso",
      includeArchived: "true",
    });
    expect(r.type).toBe("LICENSE");
    expect(r.status).toBe("VALID");
    expect(r.q).toBe("iso");
    expect(r.includeArchived).toBe(true);
  });
});

describe("assetListQuerySchema (列表路由, 锁住 max=100 不被误改)", () => {
  it("列表的 pageSize 上限仍是 100, 不会被 export 的放宽影响", () => {
    // 这两条 schema 应该是分开的; 如果谁误把 list 的 max 也改成 10000, 这个测试会失败
    const r = assetListQuerySchema.safeParse({ pageSize: "1000" });
    expect(r.success).toBe(false);
  });
});

// 模拟路由层调用: 完整传参 shape
import { exportMaxRows } from "@/lib/excel";

describe("assets/export 路由的入参解析 (修复 #1 锁住)", () => {
  it("用 exportMaxRows() 默认值 (5000) 走 assetExportQuerySchema 不再 400", () => {
    // 旧版: 1000 > assetListQuerySchema.max(100), parse 直接抛 "Too big"
    // 新版: assetExportQuerySchema.max(10000), 这个调用一定能过
    const params = assetExportQuerySchema.parse({
      page: 1,
      pageSize: exportMaxRows(),
    });
    expect(params.pageSize).toBe(5000);
    expect(params.page).toBe(1);
  });

  it("用户传了 pageSize=5000 也能过 (扩到 10000 内都可)", () => {
    const params = assetExportQuerySchema.parse({
      page: 1,
      pageSize: 5000,
    });
    expect(params.pageSize).toBe(5000);
  });

  it("filter 参数 + 大 pageSize 一并能过", () => {
    const params = assetExportQuerySchema.parse({
      page: 1,
      pageSize: exportMaxRows(),
      type: "LICENSE",
      status: "VALID",
      q: "iso",
      includeArchived: "true",
    });
    expect(params.type).toBe("LICENSE");
    expect(params.status).toBe("VALID");
    expect(params.q).toBe("iso");
    expect(params.includeArchived).toBe(true);
    expect(params.pageSize).toBe(5000);
  });
});
