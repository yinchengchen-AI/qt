"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Tag } from "antd";
import { useEffect, useState } from "react";

type Role = { code: string; name: string };

const COLORS = { ADMIN: "red", SALES: "blue", FINANCE: "green", OPS: "orange" } as Record<string, string>;

export default function RolesPage() {
  // roles 是硬编码在 lib/permissions.ts；这里只是展示
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
    <ProCard>
      <ProTable<Role>
        rowKey="code"
        headerTitle="角色"
        search={false}
        options={false}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "代码", dataIndex: "code", width: 120, render: (v) => <Tag color={COLORS[v as string] ?? "default"}>{v as string}</Tag> },
          { title: "名称", dataIndex: "name" }
        ]}
      />
      <div style={{ marginTop: 16, padding: 16, background: "#fafafa", borderRadius: 4, color: "#666", fontSize: 13 }}>
        角色权限矩阵硬编码在 <code>lib/permissions.ts</code> 中。P3 阶段将提供后台编辑界面。
      </div>
    </ProCard>
  );
}
