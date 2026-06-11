"use client";
import { ProTable } from "@ant-design/pro-components";
import { Tag, Button, App as AntdApp } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useDict } from "@/lib/dict-client";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { makeListRequest } from "@/lib/use-list-request";
import { downloadExcel } from "@/lib/excel-client";
import { DateCell } from "@/components/table-cells";

type Customer = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  customerType: string;
  scale: string | null;
  industry: string | null;
  sourceChannel: string | null;
  status: string;
  ownerUserId: string;
  contactPhone: string;
  province: string;
  city: string;
  createdAt: string;
};


export default function CustomersPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const customerTypeDict = useDict("CUSTOMER_TYPE");
  const customerScaleDict = useDict("CUSTOMER_SCALE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const statusEnum = useStatusValueEnum("customer");
  // 用 ref 拿当前表格的查询参数(关键字/状态/等级),导出时一并带上
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    const url = `/api/customers/export${qs.toString() ? `?${qs}` : ""}`;
    try {
      await downloadExcel(url, "customers.xlsx");
      message.success("已开始下载");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="客户管理"
        subtitle="线索录入、签约、跟进与等级维护;支持按地区 / 类型 / 等级筛选"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/customers/new")}>
              新建客户
            </Button>
          </>
        }
      />
      <ProTable<Customer>
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        cardBordered={false}
        request={async (params) => {
          // 记下当前查询参数,导出时复用
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
          };
          return makeListRequest<Customer>("/api/customers")(params);
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
            title: "规模",
            dataIndex: "scale",
            width: 80,
            render: (_, r) => r.scale ? (customerScaleDict.find((d) => d.code === r.scale)?.label ?? r.scale) : "—"
          },
          {
            title: "行业",
            dataIndex: "industry",
            width: 120,
            render: (_, r) => r.industry ? (industryDict.find((d) => d.code === r.industry)?.label ?? r.industry) : "—"
          },
          {
            title: "来源",
            dataIndex: "sourceChannel",
            width: 120,
            render: (_, r) => r.sourceChannel ? (sourceDict.find((d) => d.code === r.sourceChannel)?.label ?? r.sourceChannel) : "—"
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="customer" />
          },
          { title: "联系电话", dataIndex: "contactPhone", width: 140 },
          {
            title: "所在地区",
            dataIndex: "province",
            width: 160,
            render: (_, r) => `${r.province} / ${r.city}`
          },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 140,
            render: (_, r) => <DateCell value={r.createdAt} />
          }
        ]}
        options={{
          reload: () => mutate((k) => typeof k === "string" && k.startsWith("/api/customers"))
        }}
      />
    </Page>
  );
}
