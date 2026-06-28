// 统一返回导航 hook. 优化点:
// - 老逻辑 back={() => router.push("/list")} 硬编码, 丢失浏览器历史:
//   从仪表盘 widget 点进客户详情, 返回却回列表, 不是仪表盘
//   新标签页直接打开详情, 浏览器返回键卡住 (history.length = 1)
// - 新逻辑: 优先用 history.back() (有同源历史就走), 没历史或非同源时
//   fallback 到 fallback URL, 行为符合直觉

"use client";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * 返回函数 (历史优先, fallback 兜底)
 * @param fallback 没历史时 (新标签页 / 直链 / 跨域) 要去的 URL
 * @returns 无参返回函数
 *
 * 用法:
 *   const goBack = useGoBack("/customers");
 *   <PageHeader back={goBack} title="..." />
 *   <Button onClick={goBack}>返回</Button>
 */
export function useGoBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    // 优先走浏览历史. App Router 下 router.back() 在 prefetch + 软导航场景可能
    // 没历史, 用 history.length + referrer origin 一起判断, 跨域也走 fallback
    if (
      typeof window !== "undefined" &&
      window.history.length > 1 &&
      document.referrer.startsWith(window.location.origin)
    ) {
      router.back();
    } else {
      router.push(fallback);
    }
  }, [router, fallback]);
}
