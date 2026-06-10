import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** 紧凑模式：减小 padding,用于表单/详情 */
  compact?: boolean;
  /** 撑满高度,内部垂直居中 (用于 404) */
  centered?: boolean;
  className?: string;
};

export function Page({ children, compact, centered, className }: Props) {
  return (
    <div
      style={{
        padding: compact ? 16 : 24,
        maxWidth: 1280,
        margin: "0 auto",
        width: "100%",
        minHeight: centered ? "calc(100vh - 64px)" : undefined,
        display: centered ? "flex" : undefined,
        flexDirection: centered ? "column" : undefined,
        alignItems: centered ? "center" : undefined,
        justifyContent: centered ? "center" : undefined
      }}
      className={className}
    >
      {children}
    </div>
  );
}
