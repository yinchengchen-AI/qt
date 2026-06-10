"use client";
import { Card, Space, Typography } from "antd";
import type { ReactNode } from "react";

const { Title, Text } = Typography;

type Props = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** 跟下一个 FormSection 之间的间距,默认 24 */
  gap?: number;
};

/** 表单内分段卡:title + description + 内容。视觉轻,不画边框,只在头部画一条短色块。 */
export function FormSection({ title, description, icon, children, gap = 24 }: Props) {
  return (
    <div style={{ marginBottom: gap }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid #f0f0f0"
        }}
      >
        {icon ? (
          <span style={{ color: "#1677ff", display: "inline-flex" }}>{icon}</span>
        ) : (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 3,
              height: 14,
              background: "#1677ff",
              borderRadius: 2,
              transform: "translateY(2px)"
            }}
          />
        )}
        <Title level={5} style={{ margin: 0 }}>
          {title}
        </Title>
        {description ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {description}
          </Text>
        ) : null}
      </div>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {children}
      </Space>
    </div>
  );
}

/** 把一组 ProForm.Item 按 colProps 网格化(默认 1 列;colProps 决定每项占几格) */
type FormGridProps = {
  children: ReactNode;
  /** 一行列数,默认 2 (24 栅格所以默认 span=12) */
  columns?: 1 | 2 | 3;
  gap?: number;
};

import { Row, Col } from "antd";

export function FormGrid({ children, columns = 2, gap = 16 }: FormGridProps) {
  const span = 24 / columns;
  return (
    <Row gutter={[gap, gap]}>
      {Array.isArray(children) ? (
        children.map((c, i) => (
          <Col key={i} xs={24} sm={24} md={span} lg={span} xl={span}>
            {c}
          </Col>
        ))
      ) : (
        <Col span={span}>{children}</Col>
      )}
    </Row>
  );
}

/** Sticky 提交按钮条(在卡片底部浮动) */
import { Button } from "antd";

type SubmitBarProps = {
  loading?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  submitText?: string;
  cancelText?: string;
  extra?: ReactNode;
};

export function SubmitBar({
  loading,
  onSubmit,
  onCancel,
  submitText = "保存",
  cancelText = "取消",
  extra
}: SubmitBarProps) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 5,
        marginTop: 24,
        padding: "16px 24px",
        background: "#fff",
        borderTop: "1px solid #f0f0f0",
        borderRadius: "0 0 8px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        boxShadow: "0 -4px 12px -8px rgba(0,0,0,0.04)"
      }}
    >
      {extra ? <div style={{ marginRight: "auto" }}>{extra}</div> : null}
      {onCancel ? (
        <Button onClick={onCancel} disabled={loading}>
          {cancelText}
        </Button>
      ) : null}
      {onSubmit ? (
        <Button type="primary" onClick={onSubmit} loading={loading}>
          {submitText}
        </Button>
      ) : null}
    </div>
  );
}

/** 用 ProCard 包装一个表单单页(白底圆角) */
type FormCardProps = {
  children: ReactNode;
  /** 顶部贴一段说明文字 */
  headerHint?: ReactNode;
};

export function FormCard({ children, headerHint }: FormCardProps) {
  return (
    <Card
      styles={{
        body: {
          padding: 24
        }
      }}
      style={{ borderRadius: 8 }}
    >
      {headerHint ? (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "#e6f4ff",
            border: "1px solid #91caff",
            borderRadius: 6,
            fontSize: 13,
            color: "#003eb3"
          }}
        >
          {headerHint}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
