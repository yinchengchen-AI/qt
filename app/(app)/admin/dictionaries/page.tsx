"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Layout, Select, Space, message } from "antd";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";
import { DICT_DOMAINS, DICT_META, categoriesInDomain } from "@/lib/dict-domain";
import { DictCategorySider } from "./_components/DictCategorySider";
import { DictCategoryContent } from "./_components/DictCategoryContent";
import { DictTableView, type DictRow } from "./_components/DictTableView";
import { DictTreeView, type DictTreeNode } from "./_components/DictTreeView";
import { DictEditDrawer } from "./_components/DictEditDrawer";
import { CreateDictDrawer } from "./_components/CreateDictDrawer";

const { Sider, Content } = Layout;

export default function DictionariesPage() {
  const { isMobile } = useResponsive();
  const [selected, setSelected] = useState<string>(categoriesInDomain("客户域")[0] ?? "CUSTOMER_TYPE");
  const meta = DICT_META[selected];
  const isTree = meta?.shape === "tree";
  const isReadonly = meta?.readonly ?? false;

  // 列表 / 树 通用
  const [rows, setRows] = useState<DictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [keyword, setKeyword] = useState("");

  // 批量
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 各 category 的条目数 (Sider 显示用, cache)
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});

  // Drawer
  const [editTarget, setEditTarget] = useState<DictRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ parentCode: string } | null>(null);

  // ---- 数据加载 ----
  const fetchRows = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      // REGION 不在 16 类白名单, listAll 会拒, 走 legacy 树形分支
      if (selected === "REGION") {
        const r = await fetch(`/api/dictionaries?category=REGION&tree=true`, { credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) throw new Error(j.message);
        // j.data 是 DictTreeNode[], 转成 DictRow 喂给 DictTreeView (用 code 作为 id)
        const flat: DictRow[] = [];
        const walk = (nodes: Array<{ id: string; code: string; label: string; parentCode: string | null; isActive: boolean; children?: unknown[] }>) => {
          for (const n of nodes) {
            flat.push({
              id: n.id,
              code: n.code,
              label: n.label,
              sort: 0,
              isActive: n.isActive,
              parentCode: n.parentCode,
              createdAt: ""
            });
            if (n.children && (n.children as unknown[]).length > 0) walk(n.children as never);
          }
        };
        walk(j.data ?? []);
        setRows(flat);
        setCounts((prev) => ({ ...prev, REGION: flat.length }));
        return;
      }
      const qs = new URLSearchParams();
      qs.set("pageSize", "200");
      qs.set("includeInactive", includeInactive ? "true" : "false");
      qs.set("category", selected);
      if (keyword.trim()) qs.set("keyword", keyword.trim());
      const r = await fetch(`/api/dictionaries?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data.list ?? []);
      setCounts((prev) => ({ ...prev, [selected]: (j.data.list ?? []).length }));
    } catch (e) {
      const err = e as Error;
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [selected, includeInactive, keyword]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // 初次加载后, 顺便拉所有 category 的 count (Sider 显示用)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of Object.keys(DICT_META)) {
        if (cancelled) { break; }
        if (counts[c] !== undefined) continue;
        try {
          // 用 legacy 分支 (?category=X 无 pageSize/includeInactive/keyword) 兼容 REGION 等非白名单类目
          const r = await fetch(`/api/dictionaries?category=${encodeURIComponent(c)}`, { credentials: "include" });
          const j = await r.json();
          if (j.code === 0) setCounts((prev) => ({ ...prev, [c]: (j.data ?? []).length }));
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换类目时重置批量
  useEffect(() => {
    setSelectedIds(new Set());
    setBatchMode(false);
  }, [selected]);

  // ---- 操作 ----
  const onToggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onToggleSelectAll = (ids: string[], checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function onToggleActive(row: DictRow, next: boolean) {
    const r = await fetch(`/api/dictionaries/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: next })
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success(next ? "已启用" : "已停用");
    fetchRows();
  }

  async function onBatchSetActive(active: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const r = await fetch(`/api/dictionaries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: active })
      });
      const j = await r.json();
      if (j.code === 0) ok++;
      else fail++;
    }
    if (fail > 0) message.warning(`完成: ${ok} 成功, ${fail} 失败`);
    else message.success(`已${active ? "启用" : "停用"} ${ok} 条`);
    setSelectedIds(new Set());
    fetchRows();
  }

  function onEdit(row: DictRow) {
    setEditTarget(row);
  }

  // TreeView 的 selection -> 打开编辑 Drawer
  function onTreeSelect(node: DictTreeNode) {
    // 把 DictTreeNode 转 DictRow 用于编辑
    setEditTarget({
      id: node.id,
      code: node.code,
      label: node.label,
      sort: 0,
      isActive: node.isActive,
      parentCode: node.parentCode,
      createdAt: ""
    });
  }

  // TreeView 的 +子级 -> 打开 CreateDictDrawer 并预填 parentCode
  function onAddChild(parent: DictTreeNode) {
    setCreateParent({ parentCode: parent.code });
    setCreateOpen(true);
  }

  // ---- 渲染 ----
  const totalCount = useMemo(
    () => Object.values(counts).filter((v): v is number => typeof v === "number").reduce((a, b) => a + b, 0),
    [counts]
  );
  const totalCategories = Object.keys(DICT_META).length;

  return (
    <Page>
      <PageHeader
        title="数据字典"
        subtitle={`${totalCategories} 类 / 共 ${totalCount} 条 · 管理员可改`}
        actions={
          <Space>
            {!isReadonly ? (
              <Button type="primary" onClick={() => { setCreateParent(null); setCreateOpen(true); }}>
                新增字典项
              </Button>
            ) : null}
          </Space>
        }
      />
      <Layout style={{ background: "transparent", minHeight: "calc(100vh - 220px)" }}>
        {isMobile ? (
          <div style={{ padding: "8px 16px 0" }}>
            <Select
              value={selected}
              onChange={setSelected}
              style={{ width: "100%" }}
              options={DICT_DOMAINS.flatMap((d) => {
                const items = categoriesInDomain(d);
                return items.length === 0 ? [] : [
                  { label: `── ${d} ──`, value: `__header_${d}__`, disabled: true },
                  ...items.map((c) => ({ value: c, label: `${DICT_META[c]?.label ?? c} (${counts[c] ?? "—"})` }))
                ];
              })}
            />
          </div>
        ) : (
          <Sider width={240} theme="light" style={{ borderRight: "1px solid rgba(0,0,0,0.06)" }}>
            <DictCategorySider selected={selected} onSelect={setSelected} counts={counts} />
          </Sider>
        )}
        <Content style={{ padding: isMobile ? "12px 16px" : "12px 24px" }}>
          <DictCategoryContent
            category={selected}
            loading={loading}
            includeInactive={includeInactive}
            onIncludeInactiveChange={setIncludeInactive}
            keyword={keyword}
            onKeywordChange={setKeyword}
            onRefresh={fetchRows}
            onCreate={() => { setCreateParent(null); setCreateOpen(true); }}
            batchMode={batchMode}
            onBatchModeChange={setBatchMode}
            selectedCount={selectedIds.size}
            onBatchEnable={() => onBatchSetActive(true)}
            onBatchDisable={() => onBatchSetActive(false)}
            onBatchClear={() => setSelectedIds(new Set())}
          >
            {isTree ? (
              <DictTreeView
                rows={rows.map((r) => ({
                  id: r.id,
                  code: r.code,
                  label: r.label,
                  parentCode: r.parentCode,
                  isActive: r.isActive
                }))}
                loading={loading}
                keyword={keyword}
                onKeywordChange={setKeyword}
                onSelect={onTreeSelect}
                onAddChild={isReadonly ? undefined : onAddChild}
              />
            ) : (
              <DictTableView
                category={selected}
                rows={rows}
                loading={loading}
                batchMode={batchMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
                onToggleSelectAll={onToggleSelectAll}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
              />
            )}
          </DictCategoryContent>
        </Content>
      </Layout>

      <DictEditDrawer
        open={!!editTarget}
        dict={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={fetchRows}
      />

      <CreateDictDrawer
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateParent(null); }}
        onSaved={fetchRows}
        defaultCategory={selected}
        defaultParentCode={createParent?.parentCode}
      />
    </Page>
  );
}
