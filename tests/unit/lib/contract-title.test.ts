// 合同标题自动生成:覆盖年份 + 服务类型两个输入维度
// 不再拼接客户名:客户名在「客户」列/字段独立展示,避免与标题重复
import { describe, it, expect, vi, afterEach } from "vitest";
import { computeAutoTitle } from "@/lib/contract-title";

describe("computeAutoTitle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("拼接 年份 + 服务类型 + 合同(显式传 year)", () => {
    expect(computeAutoTitle("杭州阿里巴巴", "管理咨询", 2026)).toBe("2026年管理咨询合同");
  });

  it("customerName 参数不参与拼接(为兼容保留)", () => {
    // 即便传不同客户名,输出也应一致 — 客户名在「客户」列/字段独立展示
    expect(computeAutoTitle("杭州阿里巴巴", "管理咨询", 2026)).toBe("2026年管理咨询合同");
    expect(computeAutoTitle("明德教育投资有限公司", "管理咨询", 2026)).toBe("2026年管理咨询合同");
    expect(computeAutoTitle("", "管理咨询", 2026)).toBe("2026年管理咨询合同");
  });

  it("服务类型带斜杠也能正常拼接(应急/演练等)", () => {
    expect(computeAutoTitle("临平区应急管理局", "应急预案/演练", 2026)).toBe("2026年应急预案/演练合同");
  });

  it("缺少年份时回退到当前年", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-15T00:00:00Z"));
    expect(computeAutoTitle("杭州阿里巴巴", "管理咨询")).toBe("2025年管理咨询合同");
  });

  it("显式传 year=null 也回退到当前年", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-08-01T00:00:00Z"));
    expect(computeAutoTitle("杭州阿里巴巴", "管理咨询", null)).toBe("2027年管理咨询合同");
  });

  it("服务类型为空返回空串", () => {
    expect(computeAutoTitle("杭州阿里巴巴", "", 2026)).toBe("");
    expect(computeAutoTitle("杭州阿里巴巴", null, 2026)).toBe("");
    expect(computeAutoTitle("杭州阿里巴巴", undefined, 2026)).toBe("");
  });

  it("服务类型与客户名都缺仍返回空串", () => {
    expect(computeAutoTitle("", "", 2026)).toBe("");
    expect(computeAutoTitle(null, undefined, 2026)).toBe("");
  });

  it("trim 掉服务类型首尾空白(防止下拉带回的车行/全角空格污染标题)", () => {
    expect(computeAutoTitle("杭州阿里巴巴", "  管理咨询  ", 2026)).toBe("2026年管理咨询合同");
    expect(computeAutoTitle("杭州阿里巴巴", "\n管理咨询\t", 2026)).toBe("2026年管理咨询合同");
  });
});
