// useScrollSpy 的纯函数测试:避免引入 DOM 测试基建(happy-dom / jsdom / @testing-library)。
// IntersectionObserver 路径在浏览器端由 hook 自身处理;这里测核心选择逻辑。

import { describe, it, expect } from "vitest";
import { pickActiveId, pickFallbackId, type SectionRect } from "@/lib/use-scroll-spy";

describe("pickActiveId", () => {
  it("空 ratios:返回 null", () => {
    expect(pickActiveId(new Map(), ["a", "b"])).toBeNull();
  });

  it("选最大 ratio 的 id", () => {
    const m = new Map([
      ["a", 0.1],
      ["b", 0.5],
      ["c", 0.3]
    ]);
    expect(pickActiveId(m, ["a", "b", "c"])).toBe("b");
  });

  it("严格大于:相同 ratio 时返回 orderedIds 中靠前的", () => {
    const m = new Map([
      ["a", 0.5],
      ["b", 0.5]
    ]);
    expect(pickActiveId(m, ["a", "b"])).toBe("a");
  });

  it("orderedIds 里没有的 ratio 不会影响结果", () => {
    const m = new Map([
      ["a", 0.1],
      ["zz", 0.9]  // 不在 orderedIds 里
    ]);
    expect(pickActiveId(m, ["a"])).toBe("a");
  });

  it("全 0 ratio:返回 null(让调用方走 fallback)", () => {
    const m = new Map([
      ["a", 0],
      ["b", 0]
    ]);
    expect(pickActiveId(m, ["a", "b"])).toBeNull();
  });
});

describe("pickFallbackId", () => {
  it("全滚到屏幕上方:返回 null", () => {
    const rects: SectionRect[] = [
      { id: "a", top: -500, height: 200 },  // 完全滚过去
      { id: "b", top: -300, height: 200 }
    ];
    expect(pickFallbackId(rects)).toBeNull();
  });

  it("全在屏幕下方:选最靠上的(顶部 y 最小)", () => {
    const rects: SectionRect[] = [
      { id: "a", top: 100, height: 200 },
      { id: "b", top: 400, height: 200 }
    ];
    expect(pickFallbackId(rects)).toBe("a");
  });

  it("完全在视口里:选最靠上的", () => {
    const rects: SectionRect[] = [
      { id: "a", top: 0, height: 200 },
      { id: "b", top: 200, height: 200 }
    ];
    expect(pickFallbackId(rects)).toBe("a");
  });

  it("半滚过的 section 仍可选(顶部 y < topMostY 且 y > -height)", () => {
    const rects: SectionRect[] = [
      { id: "a", top: -100, height: 200 },  // 一半滚过去,top=-100, -height=-200, -100 > -200 满足
      { id: "b", top: 100, height: 200 }
    ];
    // a.top=-100, b.top=100;topMostY 取最小的,所以选 a
    expect(pickFallbackId(rects)).toBe("a");
  });

  it("完全滚过的 section(y === -height 边界)不被选(严格大于)", () => {
    const rects: SectionRect[] = [
      { id: "a", top: -200, height: 200 },  // 完全滚过去
      { id: "b", top: 0, height: 200 }
    ];
    expect(pickFallbackId(rects)).toBe("b");
  });
});
