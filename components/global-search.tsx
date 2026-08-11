"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input, Empty, Spin, Typography, theme, type InputRef } from "antd";
import {
  SearchOutlined,
  UserOutlined,
  FileTextOutlined,
  AccountBookOutlined,
  DollarOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  module: "customer" | "contract" | "invoice" | "payment";
  link: string;
};

type SearchResponse = {
  customers: SearchResult[];
  contracts: SearchResult[];
  invoices: SearchResult[];
  payments: SearchResult[];
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const MODULE_LABELS: Record<SearchResult["module"], string> = {
  customer: "客户",
  contract: "合同",
  invoice: "开票",
  payment: "回款",
};

const MODULE_ICONS: Record<SearchResult["module"], React.ReactNode> = {
  customer: <UserOutlined style={{ fontSize: 14 }} />,
  contract: <FileTextOutlined style={{ fontSize: 14 }} />,
  invoice: <AccountBookOutlined style={{ fontSize: 14 }} />,
  payment: <DollarOutlined style={{ fontSize: 14 }} />,
};

const MODULE_COLORS: Record<SearchResult["module"], string> = {
  customer: "#1677ff",
  contract: "#722ed1",
  invoice: "#13c2c2",
  payment: "#52c41a",
};

export function GlobalSearch({ open, onClose }: Props) {
  const router = useRouter();
  const { token } = theme.useToken();
  const inputRef = useRef<InputRef>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const allResults = useMemo(() => {
    if (!results) return [];
    return [
      ...results.customers,
      ...results.contracts,
      ...results.invoices,
      ...results.payments,
    ];
  }, [results]);

  const fetchResults = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.code === 0) {
        setResults(data.data);
        setActiveIndex(0);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchResults(keyword);
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword, fetchResults]);

  useEffect(() => {
    if (open) {
      setKeyword("");
      setResults(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      router.push(result.link);
      onClose();
    },
    [router, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allResults[activeIndex]) {
          handleSelect(allResults[activeIndex]);
        }
      }
    },
    [allResults, activeIndex, handleSelect]
  );

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  const groupedResults = useMemo(() => {
    if (!results) return [];
    const groups: { module: SearchResult["module"]; items: SearchResult[] }[] = [];
    for (const [module, items] of Object.entries(results) as [
      SearchResult["module"],
      SearchResult[]
    ][]) {
      if (items.length > 0) {
        groups.push({ module, items });
      }
    }
    return groups;
  }, [results]);

  const totalResults = allResults.length;
  const hasQuery = keyword.trim().length >= 2;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      afterOpenChange={(visible) => {
        if (visible) inputRef.current?.focus();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8 }}>
        <SearchOutlined style={{ color: token.colorTextSecondary, fontSize: 16 }} />
        <Input
          ref={inputRef}
          variant="borderless"
          placeholder="搜索客户、合同、发票、回款..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ fontSize: 15, padding: 0 }}
          allowClear
        />
        {loading && <Spin size="small" />}
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: 400,
          overflowY: "auto",
          borderTop: `1px solid ${token.colorSplit}`,
        }}
      >
        {!hasQuery && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="输入关键词开始搜索"
            style={{ padding: "32px 0" }}
          />
        )}

        {hasQuery && !loading && totalResults === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未找到匹配结果"
            style={{ padding: "32px 0" }}
          />
        )}

        {groupedResults.map((group) => (
          <div key={group.module}>
            <div
              style={{
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 600,
                color: token.colorTextSecondary,
                backgroundColor: token.colorBgLayout,
              }}
            >
              {MODULE_LABELS[group.module]}
              <Text type="secondary" style={{ marginLeft: 4 }}>
                ({group.items.length})
              </Text>
            </div>
            {group.items.map((item) => {
              const globalIndex = allResults.indexOf(item);
              const isActive = globalIndex === activeIndex;
              return (
                <div
                  key={`${item.module}-${item.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(item);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 16px",
                    cursor: "pointer",
                    backgroundColor: isActive ? token.colorPrimaryBg : undefined,
                    transition: "background-color 100ms",
                  }}
                  onMouseEnter={() => setActiveIndex(globalIndex)}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: `${MODULE_COLORS[item.module]}15`,
                      color: MODULE_COLORS[item.module],
                      flexShrink: 0,
                    }}
                  >
                    {MODULE_ICONS[item.module]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: token.colorText,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: token.colorTextTertiary,
                      flexShrink: 0,
                    }}
                  >
                    {MODULE_LABELS[item.module]}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "8px 16px",
          borderTop: `1px solid ${token.colorSplit}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          color: token.colorTextTertiary,
        }}
      >
        <span>
          {hasQuery && totalResults > 0 ? `共 ${totalResults} 条结果` : ""}
        </span>
        <span>
          <kbd style={kbdStyle}>↑↓</kbd> 导航{" "}
          <kbd style={kbdStyle}>↵</kbd> 选择{" "}
          <kbd style={kbdStyle}>Esc</kbd> 关闭
        </span>
      </div>
    </Modal>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  fontSize: 11,
  fontFamily: "monospace",
  border: "1px solid #d9d9d9",
  borderRadius: 3,
  backgroundColor: "#fafafa",
};
