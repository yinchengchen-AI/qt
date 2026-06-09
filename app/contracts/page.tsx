"use client";
import { ProTable, ProCard } from "@ant-design/pro-components";
import { Tag, Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  PENDING_REVIEW: "processing",
  EFFECTIVE: "green",
  EXECUTING: "cyan",
  COMPLETED: "blue",
  TERMINATED: "red",
  EXPIRED: "volcano"
};

type Row = {
  id: string;
  contractNo: string;
  customerName: string;
  title: string;
  serviceType: string;
  signDate: string;
  totalAmount: string;
  status: string;
};

export default function ContractsPage() {
  const router = useRouter();
  return (
    <ProCard>
      <ProTable<Row>
        headerTitle="合同管理"
        rowKey="id"
        search={{ labelWidth: "auto" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        toolBarRender={() => [<Button key="add" type="primary" onClick={() => router.push("/contracts/new")}>新建合同</Button>]}
        request={async (params) => {
          const qs = new URLSearchParams({
            page: String(params.current ?? 1),
            pageSize: String(params.pageSize ?? 20)
          });
          if (params.keyword) qs.set("keyword", params.keyword);
          if (params.status) qs.set("status", params.status);
          const res = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
          const j = await res.json();
          if (j.code !== 0) throw new Error(j.message);
          return { data: j.data.list, total: j.data.total, success: true };
        }}
        columns={[
          { title: "合同号", dataIndex: "contractNo", width: 180,
            render: (_, r) => <Link href={`/contracts/${r.id}`}>{r.contractNo}</Link> },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "合同标题", dataIndex: "title", width: 240 },
          { title: "服务类型", dataIndex: "serviceType", width: 120 },
          { title: "签订日", dataIndex: "signDate", valueType: "date", width: 120 },
          { title: "总额（元）", dataIndex: "totalAmount", width: 140, render: (v: any) => `¥${v}` },
          { title: "状态", dataIndex: "status", width: 110, valueEnum: {
            DRAFT: { text: "草稿" }, PENDING_REVIEW: { text: "待审批" }, EFFECTIVE: { text: "已生效" },
            EXECUTING: { text: "执行中" }, COMPLETED: { text: "已完成" }, TERMINATED: { text: "已终止" }, EXPIRED: { text: "已过期" }
          }, render: (_, r) => <Tag color={STATUS_COLOR[r.status] ?? "default"}>{r.status}</Tag> }
        ]}
      />
    </ProCard>
  );
}
