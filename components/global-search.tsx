"use client";

import { useCallback, useRef, useState } from "react";
import { AutoComplete, Input, Spin, Typography, theme, type AutoCompleteProps } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { StatusTag } from "@/components/status-tag";
import { formatCurrency } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

// 与 server/services/search.ts 的出参结构镜像 (客户端不 import server 文件)
type Group<T> = { total: number; items: T[] };
type SearchData = {
  q: string;
  customers: Group<{ id: string; code: string; name: string; shortName: string | null; contactName: string | null; contactPhone: string }>;
  contracts: Group<{ id: string; contractNo: string; title: string; customerName: string; status: string }>;
  invoices: Group<{ id: string; invoiceNo: string; customerName: string; amount: string; status: string }>;
  payments: Group<{ id: string; paymentNo: string; customerName: string; amount: string; status: string }>;
};

type Category = "customers" | "contracts" | "invoices" | "payments";
const CATEGORY_LABEL: Record<Category, string> = {
  customers: "客户",
  contracts: "合同",
  invoices: "发票",
  payments: "回款"
};
const CATEGORIES: Category[] = ["customers", "contracts", "invoices", "payments"];

const DEBOUNCE_MS = 300;
const MIN_LEN = 2;

/** 命中片段高亮: 大小写不敏感定位首个命中, 包 <mark> */
function highlight(text: string, q: string, color: string): React.ReactNode {
  const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "transparent", color, padding: 0, fontWeight: 600 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { isPhone } = useResponsive();
  const [data, setData] = useState<SearchData | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // 手机端: 图标 → 展开全宽输入条
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = q.trim();
    if (trimmed.length < MIN_LEN) {
      setData(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { code: number; data?: SearchData };
        if (!res.ok || body.code !== 0 || !body.data) throw new Error("search failed");
        setData(body.data);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setData(null);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const goto = useCallback(
    (value: string) => {
      // value 编码: hit:<category>:<id> 或 more:<category>
      const [kind, category, id] = value.split(":");
      setOpen(false);
      setExpanded(false);
      // 清理输入与未完成的搜索, 避免选中后残留内部编码值 / 落地页被旧请求重填
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setKeyword("");
      setData(null);
      if (kind === "more") {
        const base = { customers: "/customers", contracts: "/contracts", invoices: "/invoices", payments: "/payments" }[category as Category];
        router.push(`${base}?keyword=${encodeURIComponent(keyword.trim())}`);
        return;
      }
      const base = { customers: "/customers", contracts: "/contracts", invoices: "/invoices", payments: "/payments" }[category as Category];
      router.push(`${base}/${id}`);
    },
    [router, keyword]
  );

  const buildOptions = (): AutoCompleteProps["options"] => {
    if (failed) {
      return [{ value: "__failed", disabled: true, label: <Text type="secondary">搜索失败，请重试</Text> }];
    }
    if (!data) return [];
    const q = data.q;
    const groups = CATEGORIES.map((cat) => {
      const g = data[cat];
      const items = g.items.map((item) => {
        let main: React.ReactNode;
        let sub: React.ReactNode;
        if (cat === "customers") {
          const c = item as SearchData["customers"]["items"][number];
          main = highlight(c.name, q, token.colorPrimary);
          sub = `${c.code}${c.contactName ? ` · 联系人:${c.contactName}` : ""}${c.contactPhone ? ` ${c.contactPhone}` : ""}`;
        } else if (cat === "contracts") {
          const c = item as SearchData["contracts"]["items"][number];
          main = <>{highlight(c.contractNo, q, token.colorPrimary)} {highlight(c.title, q, token.colorPrimary)}</>;
          sub = (
            <>
              {c.customerName} <StatusTag status={c.status} domain="contract" />
            </>
          );
        } else if (cat === "invoices") {
          const c = item as SearchData["invoices"]["items"][number];
          main = highlight(c.invoiceNo, q, token.colorPrimary);
          sub = (
            <>
              {c.customerName} · ¥{formatCurrency(c.amount)} <StatusTag status={c.status} domain="invoice" />
            </>
          );
        } else {
          const c = item as SearchData["payments"]["items"][number];
          main = highlight(c.paymentNo, q, token.colorPrimary);
          sub = (
            <>
              {c.customerName} · ¥{formatCurrency(c.amount)} <StatusTag status={c.status} domain="payment" />
            </>
          );
        }
        return {
          value: `hit:${cat}:${item.id}`,
          label: (
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.4, padding: "2px 0" }}>
              <span style={{ fontSize: 13 }}>{main}</span>
              <Text type="secondary" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {sub}
              </Text>
            </div>
          )
        };
      });
      if (g.total > g.items.length) {
        items.push({
          value: `more:${cat}`,
          label: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              查看全部 {g.total} 条 ›
            </Text>
          )
        });
      }
      return {
        label: (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {CATEGORY_LABEL[cat]} ({g.total})
          </span>
        ),
        options: items
      };
    });
    // 全部为空时给一个提示项
    const totalHits = CATEGORIES.reduce((n, cat) => n + data[cat].total, 0);
    if (totalHits === 0) {
      return [{ value: "__empty", disabled: true, label: <Text type="secondary">未找到匹配“{data.q}”的记录</Text> }];
    }
    return groups;
  };

  const inputEl = (
    <AutoComplete
      value={keyword}
      options={buildOptions()}
      onChange={(v) => {
        // 选中条目时 antd 会以选项值 (hit:<cat>:<id> / more:<cat>) 回调 onChange, 忽略之
        if (v.startsWith("hit:") || v.startsWith("more:")) return;
        setKeyword(v);
        doSearch(v);
      }}
      onSelect={(v) => goto(v)}
      open={open && (loading || data !== null || failed)}
      onOpenChange={(v) => setOpen(v)}
      popupMatchSelectWidth={420}
      style={{ width: isPhone ? "100%" : 240 }}
      suffixIcon={loading ? <Spin size="small" /> : undefined}
    >
      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="搜客户 / 合同号 / 发票号 / 回款单"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
    </AutoComplete>
  );

  // 手机端: 默认一个搜索图标, 点开为全宽输入条 (fixed 在 Header 下方)
  if (isPhone && !expanded) {
    return (
      <button
        type="button"
        aria-label="搜索"
        title="搜索"
        onClick={() => setExpanded(true)}
        style={{
          background: "transparent",
          border: "none",
          padding: 6,
          cursor: "pointer",
          color: token.colorTextSecondary,
          fontSize: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 40,
          minHeight: 40,
          borderRadius: 6
        }}
      >
        <SearchOutlined />
      </button>
    );
  }
  if (isPhone && expanded) {
    return (
      <div
        style={{
          position: "fixed",
          top: 56,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "8px 12px",
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorSplit}`,
          display: "flex",
          gap: 8,
          alignItems: "center"
        }}
      >
        {inputEl}
        <button
          type="button"
          aria-label="关闭搜索"
          onClick={() => {
            setExpanded(false);
            setOpen(false);
          }}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: token.colorTextSecondary, fontSize: 13 }}
        >
          取消
        </button>
      </div>
    );
  }
  return inputEl;
}
