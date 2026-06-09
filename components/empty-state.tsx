import type { ReactNode } from "react";
import { Alert, Button, Empty, Spin } from "antd";
import { InboxOutlined, WarningOutlined, LoadingOutlined } from "@ant-design/icons";
import styles from "./empty-state.module.css";

type Props = {
  loading?: boolean;
  error?: { message: string; onRetry?: () => void } | null;
  empty?: boolean;
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 高度: small=160, default=240, tall=320 */
  height?: "small" | "default" | "tall";
  className?: string;
};

const HEIGHT_CLASS: Record<string, string> = {
  small:   styles.hSmall   ?? "",
  default: styles.hDefault ?? "",
  tall:    styles.hTall    ?? ""
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
  if (loading) {
    return (
      <div className={[styles.box, HEIGHT_CLASS[height], className ?? ""].filter(Boolean).join(" ")}>
        <Spin indicator={<LoadingOutlined spin />} size="large" />
        {title ? <div className={styles.title}>{title}</div> : null}
        {description ? <div className={styles.desc}>{description}</div> : null}
      </div>
    );
  }
  if (error) {
    return (
      <div className={[styles.box, HEIGHT_CLASS[height], className ?? ""].filter(Boolean).join(" ")}>
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={title ?? "加载失败"}
          description={error.message}
          action={
            error.onRetry ? (
              <Button size="small" onClick={error.onRetry}>重试</Button>
            ) : null
          }
          style={{ maxWidth: 520 }}
        />
      </div>
    );
  }
  if (empty) {
    return (
      <div className={[styles.box, HEIGHT_CLASS[height], className ?? ""].filter(Boolean).join(" ")}>
        <Empty
          image={icon ?? <InboxOutlined style={{ fontSize: 40, color: "var(--qt-text-3)" }} />}
          imageStyle={{ height: 56 }}
          description={
            <div>
              <div className={styles.title}>{title ?? "暂无数据"}</div>
              {description ? <div className={styles.desc}>{description}</div> : null}
            </div>
          }
        >
          {action}
        </Empty>
      </div>
    );
  }
  return null;
}
