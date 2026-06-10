"use client";
import { ProFormTreeSelect } from "@ant-design/pro-components";
import { useEffect, useState } from "react";

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  children?: Dept[];
};

function buildData(list: Dept[]): { value: string; title: string; children?: unknown[] }[] {
  return list.map((d) => ({
    value: d.id,
    title: `${d.name} (${d.code})`,
    children: d.children ? buildData(d.children) : undefined
  }));
}

type Props = {
  name?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  /** 排除掉自己 + 自己的所有后代（防止编辑时把自己挂成自己后代） */
  excludeSelfId?: string;
  /** 受控:外部传入当前 value */
  value?: string;
  onChange?: (value: string | undefined) => void;
};

/**
 * 共享部门树下拉,内部用 ProFormTreeSelect
 * 走 /api/departments?tree=true 拉数据
 */
export function DepartmentTreeSelect({
  name = "departmentId",
  label = "部门",
  placeholder = "不选 = 无部门",
  required = false,
  excludeSelfId,
  value,
  onChange
}: Props) {
  const [tree, setTree] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/departments?pageSize=200&tree=true&includeInactive=true", {
          credentials: "include"
        });
        const j = await r.json();
        if (!cancelled && j.code === 0) setTree(j.data.tree ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 计算要排除的节点 id 集合(self + 所有 descendant)
  function collectSelfAndDescendants(list: Dept[], selfId: string): Set<string> {
    const out = new Set<string>();
    function walk(nodes: Dept[]): boolean {
      for (const n of nodes) {
        if (n.id === selfId) {
          out.add(n.id);
          if (n.children) for (const c of n.children) out.add(c.id);
          return true;
        }
        if (n.children && walk(n.children)) {
          out.add(n.id);
          return true;
        }
      }
      return false;
    }
    walk(list);
    return out;
  }
  const exclude = excludeSelfId ? collectSelfAndDescendants(tree, excludeSelfId) : new Set<string>();
  function filterTree(nodes: Dept[]): Dept[] {
    return nodes
      .filter((n) => !exclude.has(n.id))
      .map((n) => ({
        ...n,
        children: n.children ? filterTree(n.children) : undefined
      }));
  }
  const data = buildData(excludeSelfId ? filterTree(tree) : tree);

  return (
    <ProFormTreeSelect
      name={name}
      label={label}
      placeholder={loading ? "加载中..." : placeholder}
      allowClear
      disabled={loading}
      fieldProps={{
        size: "large",
        showSearch: true,
        treeDefaultExpandAll: true,
        treeNodeFilterProp: "title",
        value,
        onChange
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request={async () => data as any}
    />
  );
}
