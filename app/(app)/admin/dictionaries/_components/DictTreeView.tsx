"use client";
import { useMemo, useState } from "react";
import { Empty, Skeleton, Tree, Tag, Input, Space, Button } from "antd";
import type { DataNode } from "antd/es/tree";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";

export type DictTreeNode = {
  id: string;
  code: string;
  label: string;
  parentCode: string | null;
  isActive: boolean;
};

type Props = {
  rows: DictTreeNode[];
  loading: boolean;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onSelect: (node: DictTreeNode) => void;
  onAddChild?: (parent: DictTreeNode) => void;
  /** 自定义 action, 比如编辑按钮 */
  renderActions?: (node: DictTreeNode) => React.ReactNode;
};

/**
 * 将平铺 (parentCode 引用) 转换成 antd Tree 的 DataNode 数组
 * - 多根 (parentCode = null) 自动归并为虚拟根 '__ROOT__', 渲染时隐藏
 * - 排序: 顶层按 sort 排, 兄弟按 sort 排 (rows 入参需已排序)
 */
function buildTree(rows: DictTreeNode[]): DataNode[] {
  const byParent = new Map<string | null, DictTreeNode[]>();
  for (const r of rows) {
    const arr = byParent.get(r.parentCode) ?? [];
    arr.push(r);
    byParent.set(r.parentCode, arr);
  }
  const buildChildren = (parentCode: string | null): DataNode[] => {
    const items = byParent.get(parentCode) ?? [];
    return items.map((r) => {
      const children = buildChildren(r.code);
      return {
        key: r.id,
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{r.code}</span>
            <span>{r.label}</span>
            {!r.isActive ? <Tag style={{ margin: 0, fontSize: 10 }}>已停用</Tag> : null}
          </span>
        ),
        raw: r,
        children: children.length > 0 ? children : undefined
      } as DataNode & { raw: DictTreeNode };
    });
  };
  // 顶层可能有多个 parentCode=null,直接展示
  return buildChildren(null);
}

/** 按关键字过滤, 命中节点 + 其所有祖先都保留 */
function filterTree(nodes: DataNode[], keyword: string): DataNode[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return nodes;
  type RN = DataNode & { raw?: DictTreeNode };
  const match = (n: RN): boolean => {
    if (!n.raw) return false;
    return (
      n.raw.code.toLowerCase().includes(k) ||
      n.raw.label.toLowerCase().includes(k)
    );
  };
  const walk = (n: RN): RN | null => {
    const children = (n.children as RN[] | undefined)?.map(walk).filter((x): x is RN => x !== null) ?? [];
    if (match(n) || children.length > 0) {
      return { ...n, children: children.length > 0 ? children : undefined };
    }
    return null;
  };
  return nodes.map((n) => walk(n as RN)).filter((x): x is DataNode => x !== null);
}

export function DictTreeView({ rows, loading, keyword, onKeywordChange, onSelect, onAddChild, renderActions }: Props) {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const tree = useMemo(() => buildTree(rows), [rows]);
  const filtered = useMemo(() => filterTree(tree, keyword), [tree, keyword]);

  if (loading && rows.length === 0) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索 code / label"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          style={{ width: 240 }}
        />
      </Space>
      {filtered.length === 0 ? (
        <Empty description={keyword ? "无匹配节点" : "该类目下暂无数据"} style={{ marginTop: 48 }} />
      ) : (
        <Tree
          showLine
          defaultExpandAll={false}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys)}
          treeData={filtered}
          titleRender={(node) => {
            const raw = (node as DataNode & { raw?: DictTreeNode }).raw;
            if (!raw) return node.title as React.ReactNode;
            return (
              <span
                onClick={() => onSelect(raw)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "2px 0" }}
              >
                {node.title as React.ReactNode}
                {onAddChild ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddChild(raw);
                    }}
                    style={{ opacity: 0.6 }}
                  />
                ) : null}
                {renderActions ? renderActions(raw) : null}
              </span>
            );
          }}
        />
      )}
    </div>
  );
}
