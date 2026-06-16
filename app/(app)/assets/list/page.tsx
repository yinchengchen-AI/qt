"use client";
import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ProTable, type ActionType } from "@ant-design/pro-components";
import { App, Button, Input, Select, Space, Tag } from "antd";
import { DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { ASSET_TYPE, type AssetType, type AssetStatus } from "@/types/enums";
import { ASSET_TYPE_MAP } from "@/lib/enum-maps";
import { downloadExcel } from "@/lib/excel-client";

type AssetRow = {
  id: string;
  code: string;
  type: string;
  name: string;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  ownerUserId: string;
  tags: string[];
  updatedAt: string;
  attributes: Record<string, unknown>;
};

type ListResp = { list: AssetRow[]; total: number; page: number; pageSize: number };

const TYPE_OPTIONS = ASSET_TYPE.map((t) => ({ value: t, label: ASSET_TYPE_MAP[t] ?? t }));

export default function AssetListPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const statusEnum = useStatusValueEnum("asset");
  const [activeType, setActiveType] = useState<AssetType | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<AssetStatus | undefined>(undefined);
  const actionRef = useRef<ActionType>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const { data: session } = useSWR<{ user: { roleCode: string } }>("/api/auth/me");
  const isAdmin = session?.user?.roleCode === "ADMIN";

  const buildQs = () => {
    const sp = new URLSearchParams();
    if (activeType) sp.set("type", activeType);
    if (statusFilter) sp.set("status", statusFilter);
    if (keyword) sp.set("q", keyword);
    return sp.toString();
  };
  const { data, isLoading, mutate } = useSWR<ListResp>(`/api/assets?${buildQs()}`);

  // 搜索 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => mutate(), 300);
  }, [keyword, activeType, statusFilter, mutate]);

  const handleExport = async () => {
    try {
      await downloadExcel(`/api/assets/export?${buildQs()}`, `assets-${new Date().toISOString().slice(0, 10)}.xlsx`);
      message.success("导出已开始");
    } catch (e) {
      message.error(`导出失败: ${(e as Error).message}`);
    }
  };

  return (
    <Page>
      <PageHeader
        title="资产列表"
        back={() => router.push("/assets")}
        actions={
          <Space>
            {isAdmin && (
              <>
                <Button icon={<UploadOutlined />} onClick={() => router.push("/assets/admin/import")}>批量导入</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/assets/new")}>录入资产</Button>
              </>
            )}
            <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 Excel</Button>
          </Space>
        }
      />

      <div style={{ marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Select
          placeholder="类型(全部)"
          allowClear
          options={TYPE_OPTIONS}
          value={activeType}
          onChange={(v) => setActiveType(v)}
          style={{ width: 180 }}
        />
        <Select
          placeholder="状态(全部)"
          allowClear
          options={(Object.keys(statusEnum) as string[]).map((k) => ({ value: k, label: statusEnum[k]?.text ?? k }))}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          style={{ width: 160 }}
        />
        <Input.Search
          placeholder="按名称 / 描述 / 编号搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 280 }}
          allowClear
        />
      </div>

      <ProTable<AssetRow>
        headerTitle={`共 ${data?.total ?? 0} 条`}
        rowKey="id"
        dataSource={data?.list ?? []}
        loading={isLoading}
        search={false}
        actionRef={actionRef}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          total: data?.total ?? 0,
          current: data?.page ?? 1,
          showTotal: (t) => `共 ${t} 条`
        }}
        onRow={(record) => ({
          onClick: () => router.push(`/assets/${record.id}`),
          style: { cursor: "pointer" }
        })}
        columns={[
          { title: "编号", dataIndex: "code", width: 130 },
          {
            title: "类型",
            dataIndex: "type",
            width: 100,
            render: (_, r) => <Tag>{ASSET_TYPE_MAP[r.type] ?? r.type}</Tag>
          },
          { title: "名称", dataIndex: "name", width: 200, ellipsis: true },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="asset" />
          },
          {
            title: "到期日",
            dataIndex: "validTo",
            width: 120,
            render: (_: unknown, r: AssetRow) => r.validTo ? new Date(r.validTo).toISOString().slice(0, 10) : "—"
          },
          {
            title: "标签",
            dataIndex: "tags",
            width: 160,
            render: (_: unknown, r: AssetRow) => (r.tags ?? []).slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)
          },
          {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 160,
            render: (_: unknown, r: AssetRow) => new Date(r.updatedAt).toISOString().slice(0, 16).replace("T", " ")
          }
        ]}
      />
    </Page>
  );
}
