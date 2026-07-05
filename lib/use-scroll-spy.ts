// ScrollSpy hook: 用 IntersectionObserver 监测一组 section 元素,返回当前
// 在视口里占比最大的那个 id(用于锚点导航高亮)。
//
// 设计要点:
// - rootMargin 顶部 64px (sticky header 高度)+ 底部 30%,让"进入视口顶部下方"
//   的 section 被认为激活,符合用户阅读节奏
// - threshold [0, 0.25, 0.5, 0.75, 1] 在每个段切换时触发,平滑
// - SSR 安全:仅在 effect 里访问 document
// - id 不存在时(动态 section 切换)返回 null
// - 纯函数 pickActiveId / pickFallback 单独可单测,避免引入 DOM 测试基建
//
// 与 next/navigation 的 hash 同步:由调用方决定。本 hook 不读/写 URL。

import { useEffect, useState } from "react";

export type SectionRect = { id: string; top: number; height: number };

/**
 * 从当前各 section 的可见比例里挑 active。
 * - 选 intersectionRatio 最大的 id
 * - 全 0 时返回 null(让调用方走 fallback 逻辑)
 */
export function pickActiveId(ratios: Map<string, number>, orderedIds: string[]): string | null {
  let bestId: string | null = null;
  let bestRatio = 0;
  for (const id of orderedIds) {
    const r = ratios.get(id) ?? 0;
    if (r > bestRatio) {
      bestRatio = r;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * 全 0 比率(滚出视口)时,回退到"离顶部最近且仍在屏幕下方"的 section。
 * - y < topMostY:更靠上
 * - y > -el.height:未完全滚过去
 */
export function pickFallbackId(rects: SectionRect[]): string | null {
  let topMost: SectionRect | null = null;
  let topMostY = Number.POSITIVE_INFINITY;
  for (const r of rects) {
    if (r.top < topMostY && r.top > -r.height) {
      topMostY = r.top;
      topMost = r;
    }
  }
  return topMost?.id ?? null;
}

export function useScrollSpy(ids: string[], options?: { topOffset?: number }): string | null {
  const topOffset = options?.topOffset ?? 64;
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || ids.length === 0) return;

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const ratios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.intersectionRatio);
        }
        const best = pickActiveId(ratios, ids);
        if (best) {
          setActiveId(best);
          return;
        }
        const rects: SectionRect[] = elements.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.id, top: r.top, height: el.offsetHeight };
        });
        setActiveId(pickFallbackId(rects));
      },
      {
        rootMargin: `-${topOffset}px 0px -30% 0px`,
        threshold: [0, 0.25, 0.5, 0.75, 1]
      }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ids 引用变化不影响,只看内容(join 做浅比较)
  }, [ids.join("|"), topOffset]);

  return activeId;
}
