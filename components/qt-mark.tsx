type Props = {
  size?: number;
  /** "amber" 用品牌主色, "navy" 走深底白字场景, "auto" 跟随 CSS 变量 */
  variant?: "amber" | "navy" | "auto";
  withWordmark?: boolean;
};

export function QtMark({ size = 32, variant = "amber", withWordmark = false }: Props) {
  const amberBg =
    variant === "navy"
      ? "linear-gradient(135deg, #16365c, #0f2a47)"
      : "linear-gradient(135deg, #f59e0b, #fbbf24)";
  const markColor = variant === "navy" ? "#fbbf24" : "#0a1c33";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        lineHeight: 1
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.22),
          display: "inline-grid",
          placeItems: "center",
          background: amberBg,
          color: markColor,
          fontWeight: 800,
          fontSize: Math.round(size * 0.5),
          letterSpacing: -0.5,
          boxShadow:
            variant === "amber"
              ? "0 6px 16px -6px rgba(245, 158, 11, 0.5)"
              : "0 6px 16px -6px rgba(10, 28, 51, 0.6)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
        }}
      >
        Q
      </span>
      {withWordmark ? (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--qt-text-1)" }}>
            杭州企泰安全科技
          </span>
          <span
            style={{
              fontSize: 10,
              letterSpacing: 2,
              color: "var(--qt-text-3)",
              fontWeight: 500
            }}
          >
            QITAI
          </span>
        </span>
      ) : null}
    </span>
  );
}
