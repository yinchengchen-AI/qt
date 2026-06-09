"use client";
import { ProTable, ProCard } from "@ant-design/pro-components";
import { Tag, Button, Space, App as AntdApp } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useDict } from "@/lib/dict-client";

type Customer = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  customerType: string;
  level: string;
  status: string;
  ownerUserId: string;
  contactPhone: string;
  province: string;
  city: string;
  createdAt: string;
};

const STATUS_COLOR: Record<string, string> = {
  LEAD: "default",
  NEGOTIATING: "processing",
  SIGNED: "success",
  LOST: "warning",
  FROZEN: "error"
};

const LEVEL_COLOR: Record<string, string> = { A: "red", B: "orange", C: "blue", D: "default" };

export default function CustomersPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { mutate } = useSWRConfig();
  const customerTypeDict = useDict("CUSTOMER_TYPE");
  const customerLevelDict = useDict("CUSTOMER_LEVEL");

  return (
    <ProCard>
      <ProTable<Customer>
        headerTitle="客户管理"
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        toolBarRender={() => [
          <Button key="add" type="primary" onClick={() => router.push("/customers/new")}>
            新建客户
          </Button>
        ]}
        request={async (params) => {
          const qs = new URLSearchParams({
            page: String(params.current ?? 1),
            pageSize: String(params.pageSize ?? 20)
          });
          if (params.keyword) qs.set("keyword", params.keyword);
          if (params.status) qs.set("status", params.status);
          if (params.level) qs.set("level", params.level);
          const res = await fetch(`/api/customers?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          { title: "客户编号", dataIndex: "code", width: 180 },
          { title: "客户名称", dataIndex: "name", width: 220,
            render: (_, r) => <Link href={`/customers/${r.id}`}>{r.name}</Link> },
          { title: "类型", dataIndex: "customerType", width: 100,
            valueEnum: Object.fromEntries(customerTypeDict.map((d) => [d.code, { text: d.label }])) },
          { title: "等级", dataIndex: "level", width: 80,
            render: (_, r) => <Tag color={LEVEL_COLOR[r.level] ?? "default"}>{r.level}</Tag> },
          { title: "状态", dataIndex: "status", width: 100,
            render: (_, r) => <Tag color={STATUS_COLOR[r.status] ?? "default"}>{r.status}</Tag> },
          { title: "联系电话", dataIndex: "contactPhone", width: 140 },
          { title: "所在地区", dataIndex: "province", width: 160,
            render: (_, r) => `${r.province} / ${r.city}` }
        ]}
        options={{ reload: () => mutate((k) => typeof k === "string" && k.startsWith("/api/customers")) }}
      />
    </ProCard>
  );
}
