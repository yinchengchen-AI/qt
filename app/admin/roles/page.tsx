"use client";
import { ProTable } from "@ant-design/pro-components";
import { Tag } from "antd";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";

type Role = { code: string; name: string };

const COLORS: Record<string, string> = {
  ADMIN: "red", SALES: "blue", FINANCE: "green", OPS: "orange"
};

export default function RolesPage() {
  // 角色权限硬编码在 lib/permissions.ts;此处仅展示
  const [rows, setRows] = useState<Role[]>([]);
  useEffect(() => {
    setRows([
      { code: "ADMIN", name: "管理员" },
      { code: "SALES", name: "业务人员" },
      { code: "FINANCE", name: "财务人员" },
      { code: "OPS", name: "行政人员" }
    ]);
  }, []);
  return (
    <Page>
      <PageHeader title="角色权限" subtitle="系统内置的 4 个角色及对应权限矩阵" />
      <ProTable<Role>
        rowKey="code"
        search={false}
        options={false}
        pagination={false}
        cardBordered={false}
        dataSource={rows}
        columns={[
          { title: "代码", dataIndex: "code", width: 120, render: (v) => <Tag color={COLORS[v as string] ?? "default"}>{v as string}</Tag> },
          { title: "名称", dataIndex: "name" }
        ]}
      />
      <div style={{ marginTop: 16, padding: 16, background: "var(--qt-bg)", border: "1px solid var(--qt-border)", borderRadius: "var(--qt-radius)", color: "var(--qt-text-2)", fontSize: 13 }}>
        角色权限矩阵硬编码在 <code>lib/permissions.ts</code> 中。P3 阶段将提供后台编辑界面。
      </div>
    </Page>
  );
}
