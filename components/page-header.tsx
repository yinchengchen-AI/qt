import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumb, Button, Space, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useResponsive } from "@/lib/use-breakpoint";

const { Title } = Typography;

type Crumb = { label: string; href?: string };

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** true = 显示返回按钮;string = 自定义返回文字(默认 "返回");function = 自定义 onClick */
  back?: boolean | string | (() => void);
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumb?: Crumb[];
  /** "page" 大标题; "section" 子区块 */
  level?: "page" | "section";
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  meta,
  breadcrumb,
  level = "page",
  className
}: Props) {
  const { isMobile, isPhone } = useResponsive();
  const isSection = level === "section";

  function renderBack() {
    if (!back) return null;
    const onClick = typeof back === "function" ? back : undefined;
    const label = typeof back === "string" ? back : "返回";
    // 手机端(<576px)只显示图标,省空间
    return (
      <Button
        type="text"
        size="small"
        icon={<ArrowLeftOutlined />}
        onClick={onClick}
        style={{ marginRight: 4, paddingInline: 6 }}
      >
        {isPhone ? null : label}
      </Button>
    );
  }

  function renderBreadcrumb() {
    if (!breadcrumb?.length) return null;
    return (
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={breadcrumb.map((c, i) => {
          const last = i === breadcrumb.length - 1;
          if (c.href && !last) return { title: <Link href={c.href}>{c.label}</Link> };
          return { title: c.label };
        })}
      />
    );
  }

  if (isSection) {
    return (
      <div className={className} style={{ marginTop: isMobile ? 16 : 24, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {title}
        </Title>
      </div>
    );
  }

  return (
    <div className={className} style={{ marginBottom: isMobile ? 16 : 24 }}>
      {renderBreadcrumb()}
      <div
        style={{
          display: "flex",
          // 移动端把 actions 折到下一行,避免挤压标题
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "flex-start",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 24,
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          {renderBack()}
          <div style={{ minWidth: 0 }}>
            <Title level={3} style={{ margin: 0, fontWeight: 600, fontSize: isMobile ? 20 : undefined }}>
              {title}
            </Title>
            {/* 手机端隐藏长副标题,留出空间 */}
            {subtitle && !isPhone ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, maxWidth: 640 }}>
                {subtitle}
              </Typography.Paragraph>
            ) : null}
          </div>
        </div>
        {(actions || meta) && (
          <Space
            wrap
            style={{
              // 移动端 actions 整组折到标题下方,左对齐
              alignSelf: isMobile ? "flex-start" : "center",
              flexShrink: 0
            }}
          >
            {meta}
            {actions}
          </Space>
        )}
      </div>
    </div>
  );
}
