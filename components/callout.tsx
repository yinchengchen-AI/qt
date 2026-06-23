import type { CSSProperties, ReactNode } from "react";

/**
 * 统一的语义化提示盒子 — 替代业务页里到处复制粘贴的
 * 内联 div + 硬编码 #fff2f0 / #e6f4ff / #fafafa 块。
 *
 * 三个变体:
 *   - <ErrorBox>   红底, 用于加载失败 / 校验失败 / 危险提示
 *   - <InfoBox>    蓝底, 用于统计区间 / 提示说明 / 来自外部的友好提醒
 *   - <HintBox>    灰底, 用于中性提示 / 数据上下文 / 权限说明
 *
 * 用法:
 *   <ErrorBox title="加载失败">网络异常,请稍后重试。<Button>重试</Button></ErrorBox>
 *   <InfoBox>置顶的公告会钉在用户消息中心顶部。</InfoBox>
 *   <HintBox>管理员/财务可看全员;销售仅看本人 owner 的合同。</HintBox>
 */

type Tone = "error" | "info" | "hint";

const TONE_VAR: Record<Tone, { bg: string; text: string; border: string }> = {
  error: { bg: "var(--qt-bg-error)", text: "var(--qt-bg-error-text)", border: "var(--qt-bg-error-text)" },
  info: { bg: "var(--qt-bg-info)", text: "var(--qt-bg-info-text)", border: "var(--qt-bg-info-line)" },
  hint: { bg: "var(--qt-bg-subtle)", text: "var(--qt-text-muted)", border: "var(--qt-border)" }
};

type Props = {
  title?: ReactNode;
  /** 自定义右侧操作区(例如「重试」按钮) */
  action?: ReactNode;
  children: ReactNode;
  /** 默认 inline-block,紧凑模式(行内提示)用 compact */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
};

function Callout({ tone, title, action, children, compact, className, style }: Props & { tone: Tone }) {
  const c = TONE_VAR[tone];
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={className}
      style={{
        display: "flex",
        alignItems: compact ? "center" : "flex-start",
        flexWrap: "wrap",
        gap: 8,
        padding: compact ? "6px 10px" : "8px 12px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 6,
        color: c.text,
        fontSize: 13,
        lineHeight: 1.5,
        wordBreak: "break-word",
        ...style
      }}
    >
      {title ? (
        <strong style={{ fontWeight: 600, marginRight: 4, color: c.text }}>{title}</strong>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBox(props: Omit<Props, "tone">) {
  return <Callout tone="error" {...props} />;
}

export function InfoBox(props: Omit<Props, "tone">) {
  return <Callout tone="info" {...props} />;
}

export function HintBox(props: Omit<Props, "tone">) {
  return <Callout tone="hint" {...props} />;
}