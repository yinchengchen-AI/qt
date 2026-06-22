"use client";
import { ProTable, type ActionType, type ProFormInstance } from "@ant-design/pro-components";
import { Button, App as AntdApp } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useDict } from "@/lib/dict-client";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { makeListRequest } from "@/lib/use-list-request";
import { downloadExcel } from "@/lib/excel-client";
import { DateCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";

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
  district: string | null;
  town: string | null;
  createdAt: string;
};


export default function CustomersPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const customerTypeDict = useDict("CUSTOMER_TYPE");
  const customerScaleDict = useDict("CUSTOMER_SCALE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const statusEnum = useStatusValueEnum("customer");
  // 用 ref 拿当前表格的查询参数(关键字/状态/等级),导出时一并带上
  const searchRef = useRef<Record<string, unknown>>({});
  const actionRef = useRef<ActionType>(undefined);
  // formRef 在需要时可以拿来手动 reset / submit, 当前列表是"点查询按钮或回车才查"的标准行为,
  // 不再自动 submit. 这个 ref 留作后续 export 时按需扩展 (如要按表单值重置导出条件).
  const formRef = useRef<ProFormInstance>(undefined);
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
            <Button key="export" size={isMobile ? "middle" : "middle"} icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/customers/new")}>
              新建客户
            </Button>
          </>
        }
      />
      <ProTable<Customer> actionRef={actionRef} formRef={formRef}
        rowKey="id"
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined, collapsed: isMobile ? false : undefined }}
        // 移动端横向滚动;Pad/桌面靠列宽自适应
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        cardBordered={false}
        sticky={isMobile}
        request={async (params) => {
          // 记下当前查询参数,导出时复用
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            scale: params.scale,
          };
          return makeListRequest<Customer>("/api/customers")(params);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          // 关键词查询: 现在点 "查询" 按钮或回车才提交 (去掉原 onChange 手动 debounce + debounceTime 之后),
          // 避免每打一个字符就触发一次请求, 改回 antd ProTable 标准交互
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "客户名 / 简称 / 编号" } },
          { title: "客户编号", dataIndex: "code", search: false, width: 180, fixed: !isMobile ? "left" : undefined },
          {
            title: "客户名称",
            dataIndex: "name",
            search: false,
            width: 220,
            render: (_, r) => <Link href={`/customers/${r.id}`}>{r.name}</Link>
          },
          {
            title: "类型",
            dataIndex: "customerType",
            width: 100,
            valueType: "select",
            // 跟 规模/行业 同款: 必须显式 valueType=select + valueEnum, 默认是文本输入框
            // 搜的是 code (ENTERPRISE/GOV/OTHER), 用户在 label (企业/政府/其他) 里选,
            // 表格里仍是 label 渲染 (valueEnum 把 code -> {text: label} 翻译过去).
            valueEnum: Object.fromEntries(customerTypeDict.map((d) => [d.code, { text: d.label }]))
          },
          {
            title: "规模",
            dataIndex: "scale",
            width: 80,
            hideInTable: true,
            valueType: "select",
            valueEnum: Object.fromEntries(customerScaleDict.map((d) => [d.code, { text: d.label }])),
            render: (_, r) => r.scale ? (customerScaleDict.find((d) => d.code === r.scale)?.label ?? r.scale) : "—"
          },
          {
            title: "行业",
            dataIndex: "industry",
            search: false,
            hideInTable: true,
            width: 120,
            render: (_, r) => r.industry ? (industryDict.find((d) => d.code === r.industry)?.label ?? r.industry) : "—"
          },
          {
            title: "来源",
            dataIndex: "sourceChannel",
            search: false,
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
          { title: "联系电话", dataIndex: "contactPhone", search: false, width: 140 },
          {
            title: "所在地区",
            dataIndex: "province",
            search: false,
            // 4 级拼接 (省 / 市 / 区 / 镇街) 最长 ~28 个汉字, 160 在移动端会折断; 桌面 240 给 4 级留够位
            width: 240,
            ellipsis: true,
            render: (_, r) => [r.province, r.city, r.district, r.town].filter(Boolean).join(" / ") || "—"
          },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            search: false,
            width: 140,
            render: (_, r) => <DateCell value={r.createdAt} />
          }
        ]}
        options={{
          reload: () => actionRef.current?.reload?.(),
          // 移动端隐藏密度/全屏等次要工具按钮,保留刷新
          density: !isMobile,
          fullScreen: !isMobile
        }}
      />
    </Page>
  );
}
