"use client";
import { CSSProperties } from "react";

/**
 * 企泰安全 logo
 *  - mark:蓝色 C/G 形方块(右侧中段缺口) + 红色小方块(右下) + 黑色小点
 *  - wordmark:"企泰安全" + "QITAI SAFETY" 副标题
 *  - variant:default(深蓝+鲜红) / light(同色,适配浅色背景) / mono(全深蓝)
 */
type Variant = "default" | "light" | "mono";

type Props = {
  size?: number;
  withWordmark?: boolean;
  wordmarkSize?: number;
  variant?: Variant;
  className?: string;
  style?: CSSProperties;
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
        viewBox="0 0 64 48"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={withWordmark ? "true" : undefined}
      >
        <defs>
          <mask id={`qitai-mask-${size}`}>
            <rect width="48" height="48" fill="white" />
            <rect x="24" y="14" width="24" height="20" fill="black" />
          </mask>
        </defs>
        <rect width="48" height="48" rx="6" fill={c.blue} mask={`url(#qitai-mask-${size})`} />
        <rect x="32" y="28" width="20" height="20" rx="3" fill={c.red} />
        <rect x="58" y="14" width="6" height="6" rx="1" fill={c.dot} />
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
              fontWeight: 700,
              letterSpacing: "0.25em",
              color: "rgba(10, 28, 51, 0.7)",
              marginTop: 4,
              textTransform: "uppercase"
            }}
          >
            QITAI SAFETY
          </span>
        </span>
      ) : null}
    </span>
  );
}
