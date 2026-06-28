// 合同标题自动填充 hook 的纯函数回归测试
// 锁住 #1 修复:之前 tryAutoFill 里直接对 (overrides?.customerName ?? customerName).trim(),
// 在非字符串输入(数字 / null / undefined / 对象)上会抛 "trim is not a function",
// 在生产页面上表现为「选客户名」步骤崩错。
//
// 这层测试不依赖 React / DOM / ProForm — 只测抽出来的纯函数 computeNextAutoTitle + toSafeName,
// 保证核心防御逻辑不会因为后续重构再被悄悄拆掉。任何非字符串输入必须:不抛 + 降级为空,
// 决不允许用 String() 把数字字面量当成客户名拼到标题里。
import { describe, it, expect } from "vitest";
import { computeNextAutoTitle, toSafeName } from "@/lib/use-contract-title-autofill";

const labels = new Map([["CONSULTING", "管理咨询"]]);

describe("toSafeName", () => {
  it("字符串原样 trim 首尾空白", () => {
    expect(toSafeName("  hello  ")).toBe("hello");
    expect(toSafeName("\n管理咨询\t")).toBe("管理咨询");
  });
  it("null / undefined / 空串 → 空串(不抛)", () => {
    expect(toSafeName(null)).toBe("");
    expect(toSafeName(undefined)).toBe("");
    expect(toSafeName("")).toBe("");
  });
  it("非字符串(数字 / 对象 / 数组 / 布尔)→ 空串(不抛,绝不允许把数字字面量当名字)", () => {
    // 之前用 String(...).trim() 会得到 "0" / "42" / "false" 等,会拼成 0 2026年管理咨询合同 这种废标题
    expect(() => toSafeName(0)).not.toThrow();
    expect(toSafeName(0)).toBe("");
    expect(toSafeName(42)).toBe("");
    expect(toSafeName(false)).toBe("");
    expect(toSafeName(true)).toBe("");
    expect(toSafeName({ toString: () => "x" })).toBe("");
    expect(toSafeName(["a", "b"])).toBe("");
  });
});

describe("computeNextAutoTitle — 非字符串 customerName 防御(回归 #1)", () => {
  const base = {
    formValues: { serviceType: "CONSULTING" },
    currentCustomerName: "",
    lastAutoFilled: "",
    serviceTypeLabelByCode: labels
  } as const;

  it("overrides.customerName 是 null / undefined / 数字 / 对象 / 数组 → 不抛,降级为空 → 返回 null", () => {
    const cases: unknown[] = [null, undefined, 0, 12345, { name: "x" }, ["a"], true, false];
    for (const bad of cases) {
      const result = computeNextAutoTitle({ ...base, overrides: { customerName: bad } });
      // 客户名解析为空 → 前置守卫 if (!cName || !sCode) return null
      expect(result).toBeNull();
    }
  });

  it("currentCustomerName 本身就是非字符串 → 不抛,降级为空 → 返回 null", () => {
    const result = computeNextAutoTitle({
      ...base,
      currentCustomerName: 12345 as unknown as string
    });
    expect(result).toBeNull();
  });

  it("serviceType 是非字符串 → 不抛,降级为空 → 返回 null", () => {
    const result = computeNextAutoTitle({
      ...base,
      formValues: { serviceType: 999 as unknown as string }
    });
    expect(result).toBeNull();
  });

  it("signDate 是非 dayjs/Date(比如字符串 / 数字)→ 不抛,extractYear 返回 null,使用当前年", () => {
    const result = computeNextAutoTitle({
      ...base,
      currentCustomerName: "杭州阿里巴巴",
      formValues: { serviceType: "CONSULTING", signDate: "not a date", title: "" }
    });
    expect(result).not.toBeNull();
    expect(result).toMatch(/^杭州阿里巴巴\d{4}年管理咨询合同$/);
  });
});

describe("computeNextAutoTitle — 正常路径", () => {
  it("空标题 + overrides 提供 customerName → 生成标题", () => {
    expect(
      computeNextAutoTitle({
        formValues: { serviceType: "CONSULTING", title: "" },
        currentCustomerName: "",
        lastAutoFilled: "",
        overrides: { customerName: "碧海建设集团有限公司" },
        serviceTypeLabelByCode: labels
      })
    ).toBe("碧海建设集团有限公司2026年管理咨询合同");
  });

  it("当前标题 = lastAutoFilled → 视为可覆盖,生成新标题", () => {
    expect(
      computeNextAutoTitle({
        formValues: { serviceType: "CONSULTING", title: "旧标题" },
        currentCustomerName: "碧海建设集团有限公司",
        lastAutoFilled: "旧标题",
        serviceTypeLabelByCode: labels
      })
    ).toBe("碧海建设集团有限公司2026年管理咨询合同");
  });

  it("当前标题 ≠ lastAutoFilled → 视为用户手动改过,返回 null 不覆盖", () => {
    expect(
      computeNextAutoTitle({
        formValues: { serviceType: "CONSULTING", title: "用户改过的标题" },
        currentCustomerName: "碧海建设集团有限公司",
        lastAutoFilled: "上一次的自动标题",
        serviceTypeLabelByCode: labels
      })
    ).toBeNull();
  });

  it("serviceType 不在字典里 → sLabel 为空 → computeAutoTitle 返回空串 → 返回 null", () => {
    expect(
      computeNextAutoTitle({
        formValues: { serviceType: "UNKNOWN", title: "" },
        currentCustomerName: "碧海建设集团有限公司",
        lastAutoFilled: "",
        serviceTypeLabelByCode: labels
      })
    ).toBeNull();
  });
});
