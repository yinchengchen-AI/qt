import type { ReactNode } from "react";
import styles from "./page.module.css";

type Props = {
  children: ReactNode;
  /** 紧凑模式:减小 padding,用于表单/详情 */
  compact?: boolean;
  /** 撑满高度,内部垂直居中 (用于 404) */
  centered?: boolean;
  className?: string;
};

export function Page({ children, compact, centered, className }: Props) {
  return (
    <div
      className={[
        styles.page,
        compact ? styles.compact : "",
        centered ? styles.centered : "",
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
