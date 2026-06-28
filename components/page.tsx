import type { ReactNode } from "react";
import { useResponsive } from "@/lib/use-breakpoint";

type Props = {
  children: ReactNode;
  /** 紧凑模式:减小 padding,用于表单/详情 */
  compact?: boolean;
  /** 撑满高度,内部垂直居中 (用于 404) */
  centered?: boolean;
  className?: string;
};

export function Page({ children, compact, centered, className }: Props) {
  const { isMobile } = useResponsive();
  // 桌面端保持 24/24 与 1280 max;移动端收紧到 12/12,放开宽度限制,允许内容铺到 100%
  const padding = isMobile
    ? (compact ? "12px 12px" : "16px 12px 24px")
    : (compact ? "16px 24px" : "24px 24px 32px");
  const maxWidth = isMobile ? undefined : 1280;
  return (
    <div
      style={{
        padding,
        maxWidth,
        margin: maxWidth ? "0 auto" : undefined,
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
