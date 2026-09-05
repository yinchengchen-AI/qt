"use client";
// 回收站 (v0.25.5 重做: 与通知中心/消息归档简洁化对齐)
//
// 后端: GET /api/admin/trash — 全量软删记录(客户/合同/发票/回款, admin only)
//       POST /api/admin/trash — 单条恢复
//
// v0.25.5 相对 P13 原版的变更:
//   - 文案全部走 i18n (trash.*), 删除时间列用 DateTimeCell 统一组件
//   - 新增工具栏: 类型筛选 Select(全部/客户/合同/发票/回款) + 关键词搜索(名称/编号) + 刷新
//   - 新增行选择 + 批量恢复(逐条调用恢复 API, 部分失败提示条数)
//   - 类型列 Tag 色板保留实体语义色; 空状态保留"返回"入口
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography
} from "antd";
import { ReloadOutlined, SearchOutlined, UndoOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";
import { DateTimeCell } from "@/components/table-cells";
import { useT } from "@/lib/i18n";

const { Text } = Typography;

type TrashItem = {
  id: string;
  entityType: string;
  name: string;
  deletedAt: string;
};

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "Customer", label: "客户" },
  { value: "Contract", label: "合同" },
  { value: "Invoice", label: "发票" },
  { value: "Payment", label: "回款" }
];

const ENTITY_TONE: Record<string, string> = {
  Customer: "blue",
  Contract: "green",
  Invoice: "purple",
  Payment: "gold"
};

const entityLabel = (entityType: string) =>
  ENTITY_OPTIONS.find((o) => o.value === entityType)?.label ?? entityType;

export default function TrashPage() {
  const t = useT();
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<TrashItem[]>("/api/admin/trash");
  const [restoring, setRestoring] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 前端筛选: 类型 + 关键词(名称/编号)
  const filtered = useMemo(() => {
    const kw = searchInput.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (typeFilter !== "all" && r.entityType !== typeFilter) return false;
      if (kw && !r.name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [data, typeFilter, searchInput]);

  const doRestore = useCallback(
    async (entityType: string, id: string): Promise<boolean> => {
      const res = await fetch("/api/admin/trash", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, id })
      });
      const j = await res.json();
      return j.code === 0;
    },
    []
  );

  const handleRestore = useCallback(
    async (item: TrashItem) => {
      setRestoring(true);
      try {
        const okFlag = await doRestore(item.entityType, item.id);
        if (okFlag) {
          message.success(t("trash.toast.restored", { name: item.name }));
          mutate();
        } else {
          message.error(t("trash.toast.actionFailed"));
        }
      } catch {
        message.error(t("trash.toast.actionFailed"));
      } finally {
        setRestoring(false);
      }
    },
    [doRestore, message, mutate, t]
  );

  // 批量恢复: 逐条调用恢复 API, 汇总成功/失败条数
  const batchRestore = useCallback(
    async (ids: React.Key[]) => {
      if (ids.length === 0) return;
      setRestoring(true);
      try {
        const items = filtered.filter((r) => ids.includes(r.id));
        let ok = 0;
        for (const item of items) {
          if (await doRestore(item.entityType, item.id)) ok++;
        }
        if (ok > 0) message.success(t("trash.toast.batchRestored", { n: ok }));
        if (ok < items.length) {
          message.warning(t("trash.toast.partialFailed", { n: items.length - ok }));
        }
        setSelectedRowKeys([]);
        mutate();
      } catch {
        message.error(t("trash.toast.actionFailed"));
      } finally {
        setRestoring(false);
      }
    },
    [filtered, doRestore, message, mutate, t]
  );

  const columns: ProColumns<TrashItem>[] = useMemo(
    () => [
      {
        title: t("trash.column.type"),
        dataIndex: "entityType",
        width: 120,
        render: (_, r) => (
          <Tag color={ENTITY_TONE[r.entityType]} style={{ margin: 0 }}>
            {entityLabel(r.entityType)}
          </Tag>
        )
      },
      {
        title: t("trash.column.name"),
        dataIndex: "name",
        ellipsis: true,
        render: (_, r) => <Text strong>{r.name}</Text>
      },
      {
        title: t("trash.column.deletedAt"),
        dataIndex: "deletedAt",
        width: 180,
        render: (_, r) => <DateTimeCell value={r.deletedAt} />
      },
      {
        title: t("trash.column.actions"),
        key: "actions",
        width: 120,
        render: (_, r) => (
          <Popconfirm
            title={t("trash.confirm.restore", { name: r.name })}
            okText={t("trash.action.restore")}
            cancelText={t("trash.cancel")}
            onConfirm={() => handleRestore(r)}
          >
            <Button
              type="link"
              size="small"
              icon={<UndoOutlined />}
              loading={restoring}
              disabled={restoring}
            >
              {t("trash.action.restore")}
            </Button>
          </Popconfirm>
        )
      }
    ],
    [t, restoring, handleRestore]
  );

  return (
    <Page>
      <PageHeader title={t("trash.title")} subtitle={t("trash.subtitle")} />

      <Card size="small" styles={{ body: { padding: 8 } }} style={{ marginBottom: 8 }}>
        <Space wrap size={8}>
          <Select
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v);
              setSelectedRowKeys([]);
            }}
            style={{ minWidth: 140 }}
            options={[
              { value: "all", label: t("trash.filter.type") },
              ...ENTITY_OPTIONS
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("trash.filter.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: isMobile ? "100%" : 240 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => mutate()}>
            {t("messages.toolbar.refresh")}
          </Button>
        </Space>
      </Card>

      {selectedRowKeys.length > 0 ? (
        <Card size="small" style={{ marginBottom: 8 }}>
          <Space wrap>
            <Text strong>{t("trash.batch.selected", { n: selectedRowKeys.length })}</Text>
            <Popconfirm
              title={t("trash.action.batchRestore")}
              okText={t("trash.action.batchRestore")}
              cancelText={t("trash.cancel")}
              onConfirm={() => batchRestore(selectedRowKeys)}
            >
              <Button
                type="primary"
                size="small"
                icon={<UndoOutlined />}
                loading={restoring}
                disabled={restoring}
              >
                {t("trash.action.batchRestore")}
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              {t("trash.batch.clear")}
            </Button>
          </Space>
        </Card>
      ) : null}

      <ProTable<TrashItem>
        rowKey={(r) => `${r.entityType}-${r.id}`}
        columns={columns}
        dataSource={filtered}
        loading={isLoading}
        search={false}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
        options={{
          reload: () => mutate(),
          density: !isMobile,
          fullScreen: !isMobile
        }}
        scroll={{ x: "max-content" }}
        cardBordered={false}
        sticky={isMobile}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: !isMobile,
          size: isMobile ? "small" : undefined
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("trash.empty")}
              style={{ marginTop: 24 }}
            >
              <Button type="primary" onClick={() => router.back()}>
                {t("trash.back")}
              </Button>
            </Empty>
          )
        }}
      />
    </Page>
  );
}
