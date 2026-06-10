type Props = {
  size?: number;
  withWordmark?: boolean;
};

export function QtMark({ size = 32, withWordmark = false }: Props) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, lineHeight: 1 }}>
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          display: "inline-grid",
          placeItems: "center",
          background: "#1677ff",
          color: "#ffffff",
          fontWeight: 600,
          fontSize: Math.round(size * 0.55)
        }}
      >
        Q
      </span>
      {withWordmark ? (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "rgba(0,0,0,0.88)" }}>
            杭州企泰安全科技
          </span>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              fontWeight: 500,
              color: "rgba(0,0,0,0.45)",
              textTransform: "uppercase"
            }}
          >
            QITAI
          </span>
        </span>
      ) : null}
    </span>
  );
}
