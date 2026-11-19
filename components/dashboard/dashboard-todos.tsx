"use client";

import Link from "next/link";
import { RightOutlined } from "@ant-design/icons";
import { Col, Row, Typography } from "antd";
import { buildTodoItems } from "./dashboard-view-model";

const { Text } = Typography;

type Props = {
  pendingInvoiceCount: number;
  over90Amount: number;
  primaryColor: string;
};

export function DashboardTodos({ pendingInvoiceCount, over90Amount, primaryColor }: Props) {
  const todoItems = buildTodoItems({ pendingInvoiceCount, over90Amount, primaryColor });
  if (todoItems.length === 0) return null;

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
      {todoItems.map((it) => (
        <Col key={it.label} xs={12} sm={6}>
          <Link href={it.href} style={{ display: "block" }}>
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                border: `1px solid ${it.color}33`,
                borderLeft: `3px solid ${it.color}`,
                background: `${it.color}0d`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{it.label}</Text>
                <div style={{ fontSize: 16, fontWeight: 600, color: it.color }}>{it.value}</div>
              </div>
              <RightOutlined style={{ color: it.color, fontSize: 12 }} />
            </div>
          </Link>
        </Col>
      ))}
    </Row>
  );
}
