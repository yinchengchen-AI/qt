"use client";
import { ProTable, type ActionType, type ProColumns } from "@ant-design/pro-components";
import { App as AntdApp, Button, Tag, Space, Switch, Radio, Table, Empty } from "antd";
import React, { useRef, useState } from "react";
import { Page } from "@/components/page";
import { useResponsive } from "@/lib/use-breakpoint";
import { PageHeader } from "@/components/page-header";
import { DictEditDrawer } from "./_components/DictEditDrawer";
import { CreateDictModal } from "./_components/CreateDictModal";
import { DICTIONARY_CATEGORY_LABEL } from "@/lib/dictionary-categories";

type Dict = {
  id: string;
  category: string;
  code: string;
  label: string;
  sort: number;
  isActive: boolean;
  createdAt: string;
};

export default function DictionariesPage() {
  const { message, modal } = AntdApp.useApp();
  const [editing, setEditing] = useState<Dict | null>(null);
  const actionRef = useRef<ActionType>(undefined);
  const { isMobile } = useResponsive();
  const [mode, setMode] = useState<"table" | "tree">("table");
  const [treeData, setTreeData] = useState<{ code: string; label: string; children: unknown[] }[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  // 切到树模式时拉一次 REGION 树
  React.useEffect(() => {
    if (mode !== "tree") return;
    let cancelled = false;
    setTreeLoading(true);
    fetch("/api/dictionaries?category=REGION&tree=true", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.code === 0) setTreeData(j.data);
        else message.error(j.message);
      })
      .finally(() => { if (!cancelled) setTreeLoading(false); });
    return () => { cancelled = true; };
  }, [mode, message]);
  const [createOpen, setCreateOpen] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);

  async function onDisable(d: Dict) {
    modal.confirm({
      title: `停用 ${d.code}?`,
      content: "软停用:该字典项将从下拉中隐藏,业务数据仍可读。",
      okType: "danger",
      onOk: async () => {
        const r = await fetch(`/api/dictionaries/${d.id}`, { method: "DELETE", credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        message.success("已停用");
        actionRef.current?.reloadAndRest?.();
      }
    });
  }

  async function onToggleActive(d: Dict, next: boolean) {
    const r = await fetch(`/api/dictionaries/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: next })
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success(next ? "已启用" : "已停用");
    actionRef.current?.reloadAndRest?.();
  }

  const columns: ProColumns<Dict>[] = [
    {
      title: "分类",
      dataIndex: "category",
      width: 160,
      render: (_, r) => <Tag color="blue">{DICTIONARY_CATEGORY_LABEL[r.category] ?? r.category}</Tag>
    },
    { title: "代码", dataIndex: "code", width: 200 },
    { title: "标签", dataIndex: "label", width: 220 },
    { title: "排序", dataIndex: "sort", width: 80, sorter: true },
    {
      title: "启用",
      dataIndex: "isActive",
      width: 100,
      render: (_, r) => (
        <Switch
          size="small"
          checked={r.isActive}
          onChange={(next) => onToggleActive(r, next)}
        />
      )
    },
    {
      title: "操作",
      width: 160,
      fixed: "right",
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setEditing(r)}>
            编辑
          </Button>
          {r.isActive ? (
            <Button type="link" size="small" danger onClick={() => onDisable(r)}>
              停用
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title="数据字典"
        subtitle="15 类白名单内的下拉 / 单选 / 状态枚举;支持增 / 改 / 启停 / 重排"
        actions={
          <Space>
            <Radio.Group
              size="small"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              optionType="button"
              style={{ marginRight: 8 }}
              options={[
                { label: "表格", value: "table" },
                { label: "树视图 (REGION)", value: "tree" }
              ]}
            />
            {mode === "table" ? (
              <span style={{ fontSize: 13, color: "rgba(0,0,0,0.65)" }}>
                <Switch size="small" checked={includeInactive} onChange={setIncludeInactive} /> 包含已停用
              </span>
            ) : null}
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新增字典项
            </Button>
          </Space>
        }
      />
      <ProTable<Dict> actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined, collapsed: isMobile ? false : undefined }} debounceTime={400}
        scroll={{ x: 'max-content' }}
        cardBordered={false}
        sticky={isMobile}
        options={{ reload: () => actionRef.current?.reload?.(), density: !isMobile, fullScreen: !isMobile }}
        pagination={{ defaultPageSize: 50, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        request={async (params) => {
          const qs = new URLSearchParams();
          qs.set("page", String(params.current ?? 1));
          qs.set("pageSize", String(params.pageSize ?? 50));
          if (params.keyword) qs.set("keyword", String(params.keyword));
          if (includeInactive) qs.set("includeInactive", "true");
          const res = await fetch(`/api/dictionaries?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
      />

      <DictEditDrawer
        open={!!editing}
        dict={editing}
        onClose={() => setEditing(null)}
        onSaved={() => actionRef.current?.reloadAndRest?.()}
      />

      <CreateDictModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => actionRef.current?.reloadAndRest?.()}
      />
    </Page>
  );
}

