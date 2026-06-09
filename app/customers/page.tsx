"use client";
import { ProTable } from "@ant-design/pro-components";
import { Tag, Button, Space } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
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

const LEVEL_COLOR: Record<string, string> = { A: "red", B: "orange", C: "blue", D: "default" };

export default function CustomersPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const customerTypeDict = useDict("CUSTOMER_TYPE");
  const customerLevelDict = useDict("CUSTOMER_LEVEL");

  return (
    <Page>
      <PageHeader
        title="客户管理"
        subtitle="线索录入、签约、跟进与等级维护;支持按地区 / 类型 / 等级筛选"
        actions={
          <Button key="add" type="primary" onClick={() => router.push("/customers/new")}>
            新建客户
          </Button>
        }
      />
      <ProTable<Customer>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        cardBordered={false}
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
          {
            title: "客户名称",
            dataIndex: "name",
            width: 220,
            render: (_, r) => <Link href={`/customers/${r.id}`}>{r.name}</Link>
          },
          {
            title: "类型",
            dataIndex: "customerType",
            width: 100,
            valueEnum: Object.fromEntries(customerTypeDict.map((d) => [d.code, { text: d.label }]))
          },
          {
            title: "等级",
            dataIndex: "level",
            width: 80,
            render: (_, r) => <Tag color={LEVEL_COLOR[r.level] ?? "default"}>{r.level}</Tag>
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (_, r) => <StatusTag status={r.status} domain="customer" />
          },
          { title: "联系电话", dataIndex: "contactPhone", width: 140 },
          {
            title: "所在地区",
            dataIndex: "province",
            width: 160,
            render: (_, r) => `${r.province} / ${r.city}`
          }
        ]}
        options={{ reload: () => mutate((k) => typeof k === "string" && k.startsWith("/api/customers")) }}
      />
    </Page>
  );
}
