"use client";
import { CSSProperties } from "react";

/**
 * 企泰安全 logo
 *  - mark:蓝色"C/G 形"方块(右上切角) + 红色小方块(右下重叠) + 黑色小点
 *  - wordmark:"企泰安全" + "QITAI · SAFETY TECH" 副标题
 *  - variant:default(深蓝底) / light(白底深 Q) / mono(线框)
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
  // 配色
  const c =
    variant === "light"
      ? { blue: "#0A1C33", red: "#E11A2A", dot: "#0A1C33" }
      : variant === "mono"
        ? { blue: "#0A1C33", red: "#0A1C33", dot: "#0A1C33" }
        : { blue: "#0A1C33", red: "#E11A2A", dot: "#0A1C33" };

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
        viewBox="0 0 62 48"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={withWordmark ? "true" : undefined}
      >
        <defs>
          <mask id={`qitai-mask-${size}`}>
            <rect width="48" height="48" fill="white" />
            <rect x="32" y="0" width="16" height="24" fill="black" />
          </mask>
        </defs>
        {/* 蓝色主体(C/G 形) */}
        <rect width="48" height="48" rx="6" fill={c.blue} mask={`url(#qitai-mask-${size})`} />
        {/* 红色小方块(右下) */}
        <rect x="32" y="28" width="20" height="20" rx="3" fill={c.red} />
        {/* 黑色小点(右上) */}
        <rect x="56" y="14" width="6" height="6" rx="1" fill={c.dot} />
      </svg>
      {withWordmark ? (
        <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span
            style={{
              fontSize: wordmarkSize,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "#0A1C33"
            }}
          >
            企泰安全
          </span>
          <span
            style={{
              fontSize: Math.max(10, wordmarkSize * 0.55),
              fontWeight: 600,
              letterSpacing: "0.25em",
              color: "rgba(10, 28, 51, 0.55)",
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
