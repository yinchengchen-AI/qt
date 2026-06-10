import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumb, Button, Space, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";

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
  const isSection = level === "section";

  function renderBack() {
    if (!back) return null;
    const onClick = typeof back === "function" ? back : undefined;
    const label = typeof back === "string" ? back : "返回";
    return (
      <Button
        type="text"
        size="small"
        icon={<ArrowLeftOutlined />}
        onClick={onClick}
        style={{ marginRight: 4, paddingInline: 6 }}
      >
        {label}
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
      <div className={className} style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {title}
        </Title>
      </div>
    );
  }

  return (
    <div className={className} style={{ marginBottom: 24 }}>
      {renderBreadcrumb()}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {renderBack()}
          <div>
            <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
              {title}
            </Title>
            {subtitle ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, maxWidth: 640 }}>
                {subtitle}
              </Typography.Paragraph>
            ) : null}
          </div>
        </div>
        {(actions || meta) && (
          <Space>
            {meta}
            {actions}
          </Space>
        )}
      </div>
    </div>
  );
}
