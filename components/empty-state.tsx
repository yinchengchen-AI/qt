import type { ReactNode } from "react";
import { Alert, Button, Empty, Spin } from "antd";

type Props = {
  loading?: boolean;
  error?: { message: string; onRetry?: () => void } | null;
  empty?: boolean;
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 高度: small=160, default=240, tall=320;也可直接传入数字(px) */
  height?: "small" | "default" | "tall" | number;
  className?: string;
};

const HEIGHT_MAP: Record<string, number> = {
  small: 160,
  default: 240,
  tall: 320
};

export function EmptyState({
  loading,
  error,
  empty,
  icon,
  title,
  description,
  action,
  height = "default",
  className
}: Props) {
  const minHeight = typeof height === "number" ? height : (HEIGHT_MAP[height] ?? HEIGHT_MAP.default);
  const wrapperStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight,
    padding: 24,
    gap: 12,
    textAlign: "center"
  };

  if (loading) {
    return (
      <div className={className} style={wrapperStyle}>
        <Spin />
        {title ? <div style={{ fontSize: 15, fontWeight: 500 }}>{title}</div> : null}
        {description ? (
          <div style={{ fontSize: 13, color: "rgba(0, 0, 0, 0.45)" }}>{description}</div>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div className={className} style={wrapperStyle}>
        <Alert
          type="error"
          showIcon
          title={title ?? "加载失败"}
          description={error.message}
          action={
            error.onRetry ? (
              <Button size="small" onClick={error.onRetry}>
                重试
              </Button>
            ) : null
          }
          style={{ maxWidth: 480 }}
        />
      </div>
    );
  }

  if (empty) {
    return (
      <div className={className} style={wrapperStyle}>
        <Empty
          image={icon ?? Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: "rgba(0,0,0,0.85)" }}>{title ?? "暂无数据"}</div>
              {description ? (
                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.45)", marginTop: 4 }}>{description}</div>
              ) : null}
            </div>
          }
        >
          {action ?? null}
        </Empty>
      </div>
    );
  }

  return null;
}
