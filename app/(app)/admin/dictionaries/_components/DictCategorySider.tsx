"use client";
import { useMemo, useState } from "react";
import { Empty, Input, Tag } from "antd";
import { LockOutlined, SearchOutlined } from "@ant-design/icons";
import { DICT_DOMAINS, DICT_META, categoriesInDomain } from "@/lib/dict-domain";

type Props = {
  selected: string;
  onSelect: (category: string) => void;
  /** 各 category 的条目数 (category -> count); undefined 时显示 - */
  counts: Record<string, number | undefined>;
};

export function DictCategorySider({ selected, onSelect, counts }: Props) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return null; // null = 不过滤, 显示全部
    // 按 label / category 模糊匹配
    return DICT_DOMAINS.map((d) => ({
      domain: d,
      items: categoriesInDomain(d).filter((c) => {
        const m = DICT_META[c];
        if (!m) return false;
        return c.toLowerCase().includes(k) || m.label.toLowerCase().includes(k);
      })
    })).filter((g) => g.items.length > 0);
  }, [keyword]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "8px 0 12px" }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索类目名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", marginRight: -8, paddingRight: 8 }}>
        {filtered ? (
          filtered.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的类目，请调整搜索关键词" />
          ) : (
            filtered.map((g) => (
              <div key={g.domain} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--qt-text-faint)", padding: "4px 8px" }}>
                  {g.domain} ({g.items.length})
                </div>
                {g.items.map((c) => (
                  <SiderItem
                    key={c}
                    category={c}
                    active={c === selected}
                    count={counts[c]}
                    onClick={() => onSelect(c)}
                  />
                ))}
              </div>
            ))
          )
        ) : (
          DICT_DOMAINS.map((d) => {
            const items = categoriesInDomain(d);
            if (items.length === 0) return null;
            return (
              <div key={d} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: "var(--qt-text-faint)", padding: "6px 8px 2px" }}>
                  {d} ({items.length})
                </div>
                {items.map((c) => (
                  <SiderItem
                    key={c}
                    category={c}
                    active={c === selected}
                    count={counts[c]}
                    onClick={() => onSelect(c)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SiderItem({
  category,
  active,
  count,
  onClick
}: {
  category: string;
  active: boolean;
  count: number | undefined;
  onClick: () => void;
}) {
  const meta = DICT_META[category];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: "pointer",
        padding: "6px 8px 6px 16px",
        borderRadius: 4,
        marginBottom: 2,
        background: active ? "rgba(22, 119, 255, 0.08)" : "transparent",
        color: active ? "var(--qt-processing)" : "inherit",
        fontWeight: active ? 500 : 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        transition: "background 0.15s"
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {meta?.readonly ? <LockOutlined style={{ marginRight: 4, fontSize: 11, color: "var(--qt-text-disabled)" }} /> : null}
        {meta?.label ?? category}
      </span>
      <Tag style={{ margin: 0, fontSize: 11, lineHeight: "16px", padding: "0 6px" }}>
        {count === undefined ? "—" : count}
      </Tag>
    </div>
  );
}
