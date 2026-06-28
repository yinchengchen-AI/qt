import type { ReactNode } from "react";
import { Card, Col, Row, Skeleton, Tooltip, Typography } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

export type StatItem = {
  label: ReactNode;
  value: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  description?: ReactNode;
  delta?: { value: ReactNode; direction?: "up" | "down" | "flat" };
  /** 鼠标悬停 label 旁的 ⓘ 图标时显示，用于说明该 KPI 的统计口径（时间范围 / 状态过滤 / 权限范围）。 */
  tooltip?: ReactNode;
};

type Props = {
  items: StatItem[];
  /** 桌面列数:2 / 3 / 4 / 5 / 6,默认 4 */
  columns?: 2 | 3 | 4 | 5 | 6;
  loading?: boolean;
  className?: string;
};

// 桌面列数 → 响应式 span 配置。xs 一律铺满一列，sm 半列，md/lg/xl 按桌面列数走
const SPAN_MAP: Record<number, { xs: number; sm: number; md: number; lg: number; xl: number }> = {
  2: { xs: 24, sm: 12, md: 12, lg: 12, xl: 12 },
  3: { xs: 24, sm: 12, md: 8,  lg: 8,  xl: 8  },
  4: { xs: 24, sm: 12, md: 12, lg: 6,  xl: 6  },
  5: { xs: 24, sm: 12, md: 12, lg: 8,  xl: 8  },
  6: { xs: 24, sm: 12, md: 8,  lg: 8,  xl: 4  }
};

export function StatGrid({ items, columns = 4, loading, className }: Props) {
  const { isMobile } = useResponsive();
  const span = SPAN_MAP[columns] ?? SPAN_MAP[4]!;
  const s = { xs: span.xs ?? 24, sm: span.sm ?? 12, md: span.md ?? 12, lg: span.lg ?? 12, xl: span.xl ?? 12 };
  const cardPadding = isMobile ? 14 : 20;
  const valueFontSize = isMobile ? 22 : 26;
  return (
    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]} className={["app-stagger", className].filter(Boolean).join(" ")}>
      {items.map((it, i) => {
        const deltaColor =
          it.delta?.direction === "up"
            ? "#52c41a"
            : it.delta?.direction === "down"
              ? "#ff4d4f"
              : undefined;
        return (
          <Col key={i} xs={s.xs} sm={s.sm} md={s.md} lg={s.lg} xl={s.xl}>
            <Card size="small" hoverable styles={{ body: { padding: cardPadding } }}>
              {loading ? (
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {it.label}
                    </Text>
                    {it.tooltip ? (
                      <Tooltip title={it.tooltip} placement="top">
                        <InfoCircleOutlined style={{ color: "#bfbfbf", fontSize: 13, cursor: "help" }} />
                      </Tooltip>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      marginTop: 6,
                      fontSize: valueFontSize,
                      fontWeight: 600,
                      lineHeight: 1.2
                    }}
                  >
                    {it.prefix ? <span style={{ fontSize: 16, color: "#00000073" }}>{it.prefix}</span> : null}
                    <span style={{ minWidth: 0, wordBreak: "break-all" }}>{it.value}</span>
                    {it.suffix ? <span style={{ fontSize: 13, color: "#00000073" }}>{it.suffix}</span> : null}
                  </div>
                  {it.description ? (
                    <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                      {it.description}
                    </Text>
                  ) : null}
                  {it.delta ? (
                    <Text style={{ fontSize: 12, color: deltaColor, display: "block", marginTop: 4 }}>
                      {it.delta.value}
                    </Text>
                  ) : null}
                </>
              )}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
