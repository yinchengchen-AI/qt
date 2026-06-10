"use client";
import { ProTable } from "@ant-design/pro-components";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { Tag } from "antd";

type Dict = { code: string; label: string };

const CATEGORY_LABEL: Record<string, string> = {
  CUSTOMER_TYPE: "客户类型",
  CUSTOMER_LEVEL: "客户等级",
  SERVICE_TYPE: "服务类型",
  CONTRACT_PAYMENT_METHOD: "合同付款方式",
  PROJECT_STATUS: "项目状态",
  INVOICE_TYPE: "发票类型",
  PAYMENT_RECEIVE_METHOD: "收款方式",
  CUSTOMER_STATUS: "客户状态",
  CONTRACT_STATUS: "合同状态",
  INVOICE_STATUS: "开票状态",
  PAYMENT_STATUS: "回款状态",
  FOLLOW_METHOD: "跟进方式",
  FOLLOW_RESULT: "跟进结果",
  REVIEW_ACTION: "审批动作"
};

export default function DictionariesPage() {
  const [rows, setRows] = useState<{ category: string; code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all(
      Object.keys(CATEGORY_LABEL)
        .map((c) =>
          fetch(`/api/dictionaries?category=${c}`, { credentials: "include" })
            .then((r) => r.json())
            .then((j) => ({ category: c, list: (j.data ?? []) as Dict[] }))
        )
    ).then((groups) => {
      const all: { category: string; code: string; label: string }[] = [];
      for (const g of groups) for (const d of g.list) all.push({ category: g.category, ...d });
      setRows(all);
      setLoading(false);
    });
  }, []);

  return (
    <Page>
      <PageHeader title="数据字典" subtitle="系统下拉 / 单选 / 状态等枚举项统一管理" />
      <ProTable
        rowKey={(r) => `${r.category}-${r.code}`}
        loading={loading}
        search={false}
        options={false}
        pagination={false}
        cardBordered={false}
        dataSource={rows}
        columns={[
          {
            title: "分类",
            dataIndex: "category",
            width: 220,
            render: (v) => <Tag color="blue">{CATEGORY_LABEL[v as string] ?? (v as string)}</Tag>
          },
          { title: "代码", dataIndex: "code", width: 220 },
          { title: "标签", dataIndex: "label" }
        ]}
      />
    </Page>
  );
}
