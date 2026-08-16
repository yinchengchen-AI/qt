"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutoComplete, Input, Spin, Typography, theme, type AutoCompleteProps } from "antd";
import type { InputRef } from "antd";
import {
  SearchOutlined,
  UserOutlined,
  FileTextOutlined,
  AccountBookOutlined,
  DollarOutlined,
  RightOutlined,
  HistoryOutlined,
  CloseOutlined,
  WarningOutlined
} from "@ant-design/icons";
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
// 分组元信息: 图标 + 品牌色, 让下拉分区一眼可辨 (此前纯文字标题视觉层级弱)
const CATEGORY_META: Record<Category, { label: string; icon: React.ReactNode; color: string }> = {
  customers: { label: "客户", icon: <UserOutlined />, color: "#1677ff" },
  contracts: { label: "合同", icon: <FileTextOutlined />, color: "#722ed1" },
  invoices: { label: "发票", icon: <AccountBookOutlined />, color: "#13c2c2" },
  payments: { label: "回款", icon: <DollarOutlined />, color: "#52c41a" }
};
const CATEGORIES: Category[] = ["customers", "contracts", "invoices", "payments"];
const CATEGORY_BASE: Record<Category, string> = {
  customers: "/customers",
  contracts: "/contracts",
  invoices: "/invoices",
  payments: "/payments"
};

const DEBOUNCE_MS = 300;
const MIN_LEN = 2;
const HISTORY_KEY = "qt-global-search-history";
const HISTORY_MAX = 5;

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

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.trim()).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

/** block=true: 全宽模式 (内容区 sticky 搜索条); 手机端直接显示输入框, 跳过图标→展开流程 */
export function GlobalSearch({ block }: { block?: boolean }) {
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
  const [history, setHistory] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<InputRef>(null);
  // 用户用过 ↑↓ 键盘导航后, Enter 交给 antd 默认选中; 否则 Enter = 查看全部
  const navUsedRef = useRef(false);

  // 挂载后读搜索历史 (SSR 安全: useEffect 只在客户端跑)
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const addHistory = useCallback((kw: string) => {
    const t = kw.trim();
    if (t.length < MIN_LEN) return;
    setHistory((prev) => {
      const next = [t, ...prev.filter((h) => h !== t)].slice(0, HISTORY_MAX);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* 隐私模式等场景忽略 */
      }
      return next;
    });
  }, []);

  const removeHistory = useCallback((kw: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== kw);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Ctrl+K / Cmd+K 全局聚焦搜索框 (桌面); 手机端展开全宽输入条
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isPhone) setExpanded(true);
        setOpen(true);
        // 手机端等 expanded 渲染完再聚焦
        setTimeout(() => inputRef.current?.focus({ cursor: "end" }), 50);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPhone]);

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
      addHistory(keyword);
      setOpen(false);
      setExpanded(false);
      // 清理输入与未完成的搜索, 避免选中后残留内部编码值 / 落地页被旧请求重填
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setKeyword("");
      setData(null);
      navUsedRef.current = false;
      const base = CATEGORY_BASE[category as Category];
      if (kind === "more") {
        router.push(`${base}?keyword=${encodeURIComponent(keyword.trim())}`);
        return;
      }
      router.push(`${base}/${id}`);
    },
    [router, keyword, addHistory]
  );

  const buildOptions = (): AutoCompleteProps["options"] => {
    // 失败态: 可点击重试
    if (failed) {
      return [
        {
          value: "__retry",
          label: (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", color: token.colorWarning }}>
              <WarningOutlined />
              <span style={{ fontSize: 13 }}>搜索失败，点击重试</span>
            </div>
          )
        }
      ];
    }
    // 1 个字符: 提示再输 1 位 (此前静默无反馈, 用户以为搜索坏了)
    if (keyword.trim().length === 1) {
      return [
        {
          value: "__hint",
          disabled: true,
          label: (
            <Text type="secondary" style={{ fontSize: 12, display: "block", textAlign: "center", padding: "8px 0" }}>
              再输入 1 个字符开始搜索
            </Text>
          )
        }
      ];
    }
    // 空输入 + 有历史: 最近搜索分组
    if (!keyword.trim()) {
      if (history.length === 0) return [];
      return [
        {
          label: (
            <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
              <HistoryOutlined style={{ marginRight: 6 }} />
              最近搜索
            </span>
          ),
          options: history.map((h) => ({
            value: `history:${h}`,
            label: (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</span>
                <CloseOutlined
                  aria-label={`删除历史 ${h}`}
                  style={{ fontSize: 10, color: token.colorTextQuaternary, padding: 4 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHistory(h);
                  }}
                />
              </div>
            )
          }))
        }
      ];
    }
    if (!data) return [];
    const q = data.q;
    const groups = CATEGORIES.map((cat) => {
      const g = data[cat];
      const meta = CATEGORY_META[cat];
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
      // "查看全部"整行醒目化: 主色 + 虚线分隔 + 右箭头, 不再混在条目里难以发现
      if (g.total > g.items.length) {
        items.push({
          value: `more:${cat}`,
          label: (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "3px 2px 1px",
                marginTop: 2,
                borderTop: `1px dashed ${token.colorSplit}`,
                color: token.colorPrimary,
                fontSize: 12,
                fontWeight: 500
              }}
            >
              <span>查看全部 {g.total} 条</span>
              <RightOutlined style={{ fontSize: 10 }} />
            </div>
          )
        });
      }
      return {
        label: (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            <span style={{ color: meta.color, marginRight: 6 }}>{meta.icon}</span>
            <span>
              {meta.label} ({g.total})
            </span>
          </span>
        ),
        options: items
      };
    });
    // 全部为空: 带图标的友好空态 (此前只有一行灰字)
    const totalHits = CATEGORIES.reduce((n, cat) => n + data[cat].total, 0);
    if (totalHits === 0) {
      return [
        {
          value: "__empty",
          disabled: true,
          label: (
            <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
              <SearchOutlined style={{ fontSize: 20, color: token.colorTextQuaternary }} />
              <div style={{ fontSize: 13, marginTop: 6 }}>未找到匹配“{data.q}”的记录</div>
              <Text type="secondary" style={{ fontSize: 12 }}>试试客户名称、合同号、发票号或回款单号</Text>
            </div>
          )
        }
      ];
    }
    return groups;
  };

  // 快捷键徽标: 空输入且非加载时显示, 提示可 Ctrl+K 唤起 (手机端无物理键盘, 不显示)
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const kbdHint =
    !keyword && !loading && !isPhone ? (
      <kbd
        style={{
          fontSize: 10,
          padding: "2px 5px",
          borderRadius: 4,
          border: `1px solid ${token.colorBorder}`,
          background: token.colorFillQuaternary,
          color: token.colorTextTertiary,
          fontFamily: "inherit",
          pointerEvents: "none"
        }}
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    ) : undefined;

  const trimmedLen = keyword.trim().length;
  // trimmedLen >= 1: 输入任意字符后保持下拉常开 (1 字符显示"再输入 1 个字符"提示,
  // ≥2 显示 Spin/结果); 若只在 =1 时开, 防抖 300ms 窗口内 loading=false+data=null
  // 会让下拉闪关并触发 antd onOpenChange(false) 锁死 open 状态 (e2e 实测竞态)
  const dropdownOpen =
    open && (loading || data !== null || failed || trimmedLen >= 1 || (!keyword.trim() && history.length > 0));

  const inputEl = (
    <AutoComplete
      value={keyword}
      options={buildOptions()}
      onChange={(v) => {
        // 选中条目时 antd 会以选项值 (hit:/more:/history:) 回调 onChange, 忽略之
        if (v.startsWith("hit:") || v.startsWith("more:") || v.startsWith("history:")) return;
        setKeyword(v);
        setData(null);
        navUsedRef.current = false;
        doSearch(v);
      }}
      onSelect={(v) => {
        if (v === "__retry") {
          doSearch(keyword);
          return;
        }
        if (v.startsWith("history:")) {
          const kw = v.slice("history:".length);
          setKeyword(kw);
          doSearch(kw);
          return;
        }
        goto(v);
      }}
      open={dropdownOpen}
      onOpenChange={(v) => setOpen(v)}
      popupMatchSelectWidth={block ? true : 480}
      style={{ width: block || isPhone ? "100%" : 280 }}
      suffixIcon={loading ? <Spin size="small" /> : kbdHint}
    >
      <Input
        ref={inputRef}
        allowClear
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="搜客户 / 合同号 / 发票号 / 回款单"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") navUsedRef.current = true;
          // Enter: 未用 ↑↓ 导航时跳"查看全部"列表页 (antd 只在有 active 项时才触发 onSelect,
          // 没有时 Enter 是哑键); 用过 ↑↓ 则交给 antd 默认选中, 两者不冲突
          if (e.key === "Enter" && !navUsedRef.current && data) {
            const firstCat = CATEGORIES.find((c) => data[c].total > 0);
            if (firstCat) {
              e.preventDefault();
              goto(`more:${firstCat}`);
            }
          }
        }}
      />
    </AutoComplete>
  );

  // 手机端 (非 block): 默认一个搜索图标, 点开为全宽输入条 (fixed 在 Header 下方)
  if (!block && isPhone && !expanded) {
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
  if (!block && isPhone && expanded) {
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
