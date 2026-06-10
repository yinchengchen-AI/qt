"use client";
import { CSSProperties } from "react";

/**
 * 企泰安全 logo 还原
 *  - mark：蓝色圆角方块 + 白色 "Q" 轮廓 + 红/橙斜杠（替代 Q 尾巴）
 *  - wordmark："企泰安全" 橙字 + "QITAI · SAFETY TECH" 灰字副标题
 *  - variant：default(深色背景/亮底) / light(深底) — 仅影响 mark 配色
 */
type Variant = "default" | "light" | "mono";

type Props = {
  /** 仅 mark 的边长,单位 px,默认 32 */
  size?: number;
  /** 是否带文字 wordmark */
  withWordmark?: boolean;
  /** 文字可选大小,默认 16 */
  wordmarkSize?: number;
  variant?: Variant;
  className?: string;
  style?: CSSProperties;
  /** 整体 aria-label,默认"杭州企泰安全科技" */
  title?: string;
};

export function QtMark({
  size = 32,
  withWordmark = false,
  wordmarkSize = 16,
  variant = "default",
  className,
  style,
  title = "杭州企泰安全科技"
}: Props) {
  // mark 配色
  const markColors =
    variant === "light"
      ? { bg: "#ffffff", ring: "#0A1C33", q: "#0A1C33", slash: "#F25C44" }
      : variant === "mono"
        ? { bg: "transparent", ring: "#0A1C33", q: "#0A1C33", slash: "#0A1C33" }
        : { bg: "#0A1C33", ring: "#0A1C33", q: "#ffffff", slash: "#F25C44" };

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32, lineHeight: 1, ...style }}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 56 56"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={withWordmark ? "true" : undefined}
      >
        {/* 圆角方块底 */}
        <rect x="2" y="2" width="52" height="52" rx="12" fill={markColors.bg} stroke={markColors.ring} strokeWidth={variant === "mono" ? 1.5 : 0} />
        {/* Q 字母外环 */}
        <circle cx="24" cy="26" r="11" fill="none" stroke={markColors.q} strokeWidth="4" />
        {/* Q 尾巴(被斜杠替代前的位置,保留一个端点) */}
        <path d="M31 33 L36 38" stroke={markColors.q} strokeWidth="4" strokeLinecap="round" fill="none" />
        {/* 红/橙斜杠 — 替代 Q 尾巴作为视觉焦点 */}
        <path d="M33 30 L48 45 L42 51 L27 36 Z" fill={markColors.slash} />
      </svg>
      {withWordmark ? (
        <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span
            style={{
              fontSize: wordmarkSize,
              fontWeight: 700,
              letterSpacing: "0.05em",
              background: "linear-gradient(90deg, #F59E0B 0%, #EA7C1A 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              color: "#F59E0B"
            }}
          >
            企泰安全
          </span>
          <span
            style={{
              fontSize: Math.max(10, wordmarkSize * 0.55),
              fontWeight: 600,
              letterSpacing: "0.25em",
              color: "rgba(0, 0, 0, 0.45)",
              marginTop: 4,
              textTransform: "uppercase"
            }}
          >
            QITAI · SAFETY TECH
          </span>
        </span>
      ) : null}
    </span>
  );
}
