"use client";
import { Button, Input, Segmented, Space, Tag } from "antd";
import { LockOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { DICT_META } from "@/lib/dict-domain";

type Props = {
  category: string;
  loading: boolean;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  /** 是否进入批量模式 */
  batchMode: boolean;
  onBatchModeChange: (v: boolean) => void;
  /** 已选条目数 (批量模式时) */
  selectedCount: number;
  onBatchEnable: () => void;
  onBatchDisable: () => void;
  onBatchClear: () => void;
  children: React.ReactNode;
};

export function DictCategoryContent({
  category,
  loading,
  includeInactive,
  onIncludeInactiveChange,
  keyword,
  onKeywordChange,
  onRefresh,
  onCreate,
  batchMode,
  onBatchModeChange,
  selectedCount,
  onBatchEnable,
  onBatchDisable,
  onBatchClear,
  children
}: Props) {
  const meta = DICT_META[category];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 类目头 */}
      <div style={{ paddingBottom: 12, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{meta?.label ?? category}</span>
          <Tag style={{ margin: 0 }}>{category}</Tag>
          {meta?.readonly ? (
            <Tag color="warning" icon={<LockOutlined />}>
              系统字典 · 只读
            </Tag>
          ) : null}
          {meta?.description ? (
            <span style={{ fontSize: 12, color: "var(--qt-text-faint)" }}>{meta.description}</span>
          ) : null}
        </div>
      </div>

      {/* 工具条 */}
      <div
        style={{
          padding: "12px 0",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <Input.Search
          allowClear
          placeholder="搜索 code / label"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          style={{ width: 240 }}
        />
        <Segmented
          size="small"
          value={includeInactive ? "all" : "active"}
          onChange={(v) => onIncludeInactiveChange(v === "all")}
          options={[
            { label: "仅启用", value: "active" },
            { label: "包含停用", value: "all" }
          ]}
        />
        <div style={{ flex: 1 }} />
        {meta?.readonly ? null : (
          <Space>
            <Button
              size="small"
              type={batchMode ? "primary" : "default"}
              onClick={() => onBatchModeChange(!batchMode)}
            >
              {batchMode ? `批量 (${selectedCount})` : "批量"}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              新增
            </Button>
          </Space>
        )}
      </div>

      {/* 批量工具条 */}
      {batchMode && !meta?.readonly ? (
        <div
          style={{
            padding: "6px 12px",
            background: "rgba(22, 119, 255, 0.04)",
            border: "1px solid rgba(22, 119, 255, 0.15)",
            borderRadius: 4,
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >
          <span style={{ fontSize: 13 }}>已选 {selectedCount} 条</span>
          <Button size="small" type="primary" onClick={onBatchEnable} disabled={selectedCount === 0}>
            批量启用
          </Button>
          <Button size="small" danger onClick={onBatchDisable} disabled={selectedCount === 0}>
            批量停用
          </Button>
          <Button size="small" onClick={onBatchClear}>
            取消选择
          </Button>
        </div>
      ) : null}

      {/* 视图区 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}
