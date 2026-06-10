"use client";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App as AntdApp, Button, Space, Switch, Tag, Tree, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useListRequest } from "@/lib/use-list-request";

const { Text } = Typography;

type Department = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sort: number;
  isActive: boolean;
  memberCount: number;
  children?: Department[];
};

export default function DepartmentsPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const [view, setView] = useState<"tree" | "list">("tree");
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data, loading, reload } = useListRequest<Department>(
    `/api/departments?pageSize=200&tree=${view === "tree"}&includeInactive=${includeInactive}`,
    { deps: [view, includeInactive] }
  );

  async function onDelete(d: Department) {
    if (d.memberCount > 0 || (d.children && d.children.length > 0)) {
      message.error("该部门仍有子部门或成员,无法删除");
      return;
    }
    const r = await fetch(`/api/departments/${d.id}`, { method: "DELETE", credentials: "include" });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success("已删除");
    reload();
  }

  const columns: ProColumns<Department>[] = [
    { title: "代码", dataIndex: "code", width: 140 },
    { title: "名称", dataIndex: "name", width: 200 },
    {
      title: "层级",
      dataIndex: "depth",
      width: 100,
      render: (_, r) => {
        // 用 parentId 简单算深度
        let d = 0;
        let cur: string | null | undefined = r.parentId;
        const map = new Map((data ?? []).map((x) => [x.id, x.parentId] as const));
        while (cur) {
          d++;
          if (d > 10) break;
          cur = map.get(cur) ?? null;
        }
        return <Tag color="blue">{d === 0 ? "顶级" : `${d} 级`}</Tag>;
      }
    },
    {
      title: "成员",
      dataIndex: "memberCount",
      width: 100,
      render: (_: unknown, r: Department) => <Tag color={r.memberCount > 0 ? "green" : "default"}>{r.memberCount}</Tag>
    },
    {
      title: "子部门",
      dataIndex: "id",
      width: 100,
      render: (_: unknown, r: Department) => {
        const n = (r.children ?? []).length;
        return <Tag color={n > 0 ? "blue" : "default"}>{n}</Tag>;
      }
    },
    {
      title: "状态",
      dataIndex: "isActive",
      width: 80,
      render: (_, r) => (
        <Tag color={r.isActive ? "green" : "default"}>{r.isActive ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "操作",
      width: 200,
      fixed: "right",
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => router.push(`/admin/departments/${r.id}`)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => router.push(`/admin/departments/${r.id}/edit`)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            disabled={r.memberCount > 0 || (r.children && r.children.length > 0)}
            onClick={() => onDelete(r)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  // 树形展示的 treeSelectable 转换
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const treeData: any[] = ((data ?? []) as Department[]).map((d) => ({
    key: d.id,
    title: (
      <Space size={4}>
        <Text strong={!d.parentId}>{d.name}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>({d.code})</Text>
        {!d.isActive && <Tag>停用</Tag>}
        {d.memberCount > 0 && (
          <Tag color="green" style={{ marginLeft: 4 }}>
            {d.memberCount} 人
          </Tag>
        )}
        {d.children && d.children.length > 0 && (
          <Tag color="blue">{d.children.length} 子</Tag>
        )}
      </Space>
    ),
    children: (d.children ?? []) as Department[]
  }));

  return (
    <Page>
      <PageHeader
        title="部门管理"
        subtitle="树形部门;支持任意层级嵌套;子部门 / 成员非空不可删"
        actions={
          <Space>
            <Switch
              size="small"
              checked={view === "tree"}
              onChange={(v) => setView(v ? "tree" : "list")}
              checkedChildren="树形"
              unCheckedChildren="列表"
            />
            <Switch
              size="small"
              checked={includeInactive}
              onChange={setIncludeInactive}
              checkedChildren="含停用"
              unCheckedChildren="仅启用"
            />
            <Button type="primary" onClick={() => router.push("/admin/departments/new")}>
              新建部门
            </Button>
          </Space>
        }
      />

      {view === "tree" ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 16,
            minHeight: 200
          }}
        >
          {loading ? (
            <Text type="secondary">加载中...</Text>
          ) : (data ?? []).length === 0 ? (
            <Text type="secondary">暂无部门。点右上角\"新建部门\"开始。</Text>
          ) : (
            <Tree treeData={treeData} defaultExpandAll selectable={false} />
          )}
        </div>
      ) : (
        <ProTable<Department>
          rowKey="id"
          loading={loading}
          columns={columns}
          search={false}
          toolbar={{ settings: [] }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          dataSource={data ?? []}
        />
      )}
    </Page>
  );
}
