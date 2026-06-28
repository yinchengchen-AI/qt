"use client";
import { useMemo } from "react";
import { Button, Checkbox, Empty, Skeleton, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DICT_META } from "@/lib/dict-domain";

export type DictRow = {
  id: string;
  code: string;
  label: string;
  sort: number;
  isActive: boolean;
  parentCode: string | null;
  createdAt: string;
};

type Props = {
  category: string;
  rows: DictRow[];
  loading: boolean;
  batchMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[], checked: boolean) => void;
  onEdit: (row: DictRow) => void;
  onToggleActive: (row: DictRow, next: boolean) => void;
};

export function DictTableView({
  category,
  rows,
  loading,
  batchMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onToggleActive
}: Props) {

  const meta = DICT_META[category];
  const isReadonly = meta?.readonly ?? false;

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  const columns: ColumnsType<DictRow> = [
    ...(batchMode && !isReadonly
      ? [
          {
            title: () => (
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={(e) => onToggleSelectAll(allIds, e.target.checked)}
              />
            ),
            width: 48,
            render: (_: unknown, r: DictRow) => (
              <Checkbox
                checked={selectedIds.has(r.id)}
                onChange={() => onToggleSelect(r.id)}
              />
            )
          }
        ]
      : []),
    {
      title: "代码",
      dataIndex: "code",
      width: 220,
      render: (v: string) => <span style={{ fontFamily: "ui-monospace, monospace" }}>{v}</span>
    },
    {
      title: "标签",
      dataIndex: "label",
      width: 240
    },
    {
      title: "父级",
      dataIndex: "parentCode",
      width: 160,
      render: (v: string | null) =>
        v ? <Tag>{v}</Tag> : <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
    },
    {
      title: "排序",
      dataIndex: "sort",
      width: 80,
      sorter: (a, b) => a.sort - b.sort,
      defaultSortOrder: "ascend" as const
    },
    {
      title: "启用",
      dataIndex: "isActive",
      width: 80,
      render: (v: boolean, r: DictRow) =>
        isReadonly ? (
          v ? <Tag color="green">已启用</Tag> : <Tag>已停用</Tag>
        ) : (
          <Switch
            size="small"
            checked={v}
            onChange={(next) => onToggleActive(r, next)}
          />
        )
    },
    {
      title: "操作",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, r: DictRow) =>
        isReadonly ? (
          <span style={{ color: "var(--qt-text-disabled)", fontSize: 12 }}>系统字典</span>
        ) : (
          <Button type="link" size="small" onClick={() => onEdit(r)}>
            编辑
          </Button>
        )
    }
  ];

  if (loading && rows.length === 0) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  if (!loading && rows.length === 0) {
    return <Empty description="该类目下暂无字典项，请新增" style={{ marginTop: 48 }} />;
  }

  return (
    <Table<DictRow>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, size: "small" }}
      scroll={{ x: "max-content" }}
    />
  );
}
