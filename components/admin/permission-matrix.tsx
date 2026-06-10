"use client";
import { Checkbox, Space, Table, Tag, Typography } from "antd";
import { RESOURCE, ACTION } from "@/lib/permissions";

const { Text } = Typography;

const ACTION_LIST: { value: string; label: string; color?: string }[] = [
  { value: ACTION.READ, label: "读" },
  { value: ACTION.CREATE, label: "增" },
  { value: ACTION.UPDATE, label: "改" },
  { value: ACTION.DELETE, label: "删" },
  { value: ACTION.EXPORT, label: "导出" },
  { value: ACTION.AUDIT, label: "审计" }
];

const RESOURCE_LIST: { value: string; label: string; group?: string }[] = [
  { value: RESOURCE.USER, label: "用户", group: "系统" },
  { value: RESOURCE.ROLE, label: "角色", group: "系统" },
  { value: RESOURCE.DICTIONARY, label: "字典", group: "系统" },
  { value: RESOURCE.OPERATION_LOG, label: "操作日志", group: "系统" },
  { value: RESOURCE.CUSTOMER, label: "客户", group: "业务" },
  { value: RESOURCE.CONTRACT, label: "合同", group: "业务" },
  { value: RESOURCE.PROJECT, label: "项目", group: "业务" },
  { value: RESOURCE.INVOICE, label: "开票", group: "财务" },
  { value: RESOURCE.PAYMENT, label: "回款", group: "财务" },
  { value: RESOURCE.STATISTICS, label: "统计", group: "分析" },
  { value: RESOURCE.MESSAGE, label: "消息", group: "运营" },
  { value: RESOURCE.ANNOUNCEMENT, label: "公告", group: "运营" }
];

export type Permission = { resource: string; actions: string[] };

type Props = {
  value: Permission[];
  onChange?: (next: Permission[]) => void;
  readOnly?: boolean;
};

export function PermissionMatrix({ value, onChange, readOnly }: Props) {
  // 归一化:给每个 resource 至少一个空 actions 数组
  const byRes = new Map<string, Set<string>>();
  for (const p of value) {
    byRes.set(p.resource, new Set(p.actions));
  }
  for (const r of RESOURCE_LIST) {
    if (!byRes.has(r.value)) byRes.set(r.value, new Set());
  }

  function toggle(res: string, act: string, checked: boolean) {
    if (readOnly || !onChange) return;
    const cur = byRes.get(res) ?? new Set();
    if (checked) cur.add(act);
    else cur.delete(act);
    byRes.set(res, new Set(cur));
    // 序列化：actions 为空的不写入
    const next: Permission[] = [];
    for (const r of RESOURCE_LIST) {
      const a = byRes.get(r.value);
      if (a && a.size > 0) next.push({ resource: r.value, actions: Array.from(a) });
    }
    onChange(next);
  }

  function selectAllForResource(res: string, allActions: string[]) {
    if (readOnly || !onChange) return;
    byRes.set(res, new Set(allActions));
    const next: Permission[] = [];
    for (const r of RESOURCE_LIST) {
      const a = byRes.get(r.value);
      if (a && a.size > 0) next.push({ resource: r.value, actions: Array.from(a) });
    }
    onChange(next);
  }

  function clearForResource(res: string) {
    if (readOnly || !onChange) return;
    byRes.set(res, new Set());
    const next: Permission[] = [];
    for (const r of RESOURCE_LIST) {
      const a = byRes.get(r.value);
      if (a && a.size > 0) next.push({ resource: r.value, actions: Array.from(a) });
    }
    onChange(next);
  }

  const columns = [
    {
      title: "资源",
      dataIndex: "label",
      width: 160,
      fixed: "left" as const,
      render: (label: string, row: { value: string; group?: string }) => (
        <Space size={6}>
          <Text strong>{label}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.value}</Text>
        </Space>
      )
    },
    ...ACTION_LIST.map((a) => ({
      title: a.label,
      dataIndex: a.value,
      width: 80,
      align: "center" as const,
      render: (_: unknown, row: { value: string }) => {
        const cur = byRes.get(row.value);
        const checked = cur?.has(a.value) ?? false;
        return readOnly ? (
          checked ? <Tag color="blue">✓</Tag> : <Text type="secondary">-</Text>
        ) : (
          <Checkbox
            checked={checked}
            onChange={(e) => toggle(row.value, a.value, e.target.checked)}
          />
        );
      }
    })),
    {
      title: "操作",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, row: { value: string }) => {
        if (readOnly) return null;
        const cur = byRes.get(row.value);
        const allChecked = ACTION_LIST.every((a) => cur?.has(a.value));
        return allChecked ? (
          <a onClick={() => clearForResource(row.value)}>清空</a>
        ) : (
          <a onClick={() => selectAllForResource(row.value, ACTION_LIST.map((a) => a.value))}>
            全选
          </a>
        );
      }
    }
  ];

  return (
    <Table
      rowKey="value"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={RESOURCE_LIST}
      scroll={{ x: 720 }}
    />
  );
}
