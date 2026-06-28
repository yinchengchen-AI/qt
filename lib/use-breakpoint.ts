"use client";

import { Grid } from "antd";
import { useEffect, useState } from "react";

export type BreakpointKey = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

/**
 * 薄包装 antd `Grid.useBreakpoint()`,SSR 安全。
 *
 * - SSR / 首次渲染返回 `null` 对象 + `isMobile=false`,避免水合不一致。
 * - 客户端水合后由 antd 填入真实断点。
 *
 * 用法:
 *   const { md, isMobile } = useResponsive();
 *   if (!isMobile) return <DesktopLayout />;
 *   return <MobileLayout />;
 */
export function useResponsive(): {
  /** 水合前的 SSR 渲染为 null;客户端拿到真实断点后才填入 */
  bp: Partial<Record<BreakpointKey, boolean>> | null;
  /** 屏宽 >= 768px (含 iPad) */
  md: boolean;
  /** 屏宽 >= 576px */
  sm: boolean;
  /** 屏宽 >= 992px */
  lg: boolean;
  /** 屏宽 < 768px */
  isMobile: boolean;
  /** 屏宽 < 576px */
  isPhone: boolean;
} {
  const bp = Grid.useBreakpoint();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // antd 在 SSR 阶段会返回空对象,在客户端才填入;这里把 SSR 与首屏的
  // 判定统一为"未知" -> 走最保守的桌面布局,客户端拿到断点后再切。
  const md = hydrated && !!bp.md;
  const sm = hydrated && !!bp.sm;
  const lg = hydrated && !!bp.lg;
  const isMobile = hydrated ? !md : false;
  const isPhone = hydrated ? !sm : false;

  return { bp: hydrated ? bp : null, md, sm, lg, isMobile, isPhone };
}
