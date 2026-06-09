"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Button, Space, App as AntdApp, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";

type Contract = {
  id: string; contractNo: string; customerId: string; customerName: string;
  title: string; serviceType: string; signDate: string; startDate: string;
  endDate: string; totalAmount: string; taxRate: string; taxAmount: string;
  amountExcludingTax: string; paymentMethod: string; status: string;
  attachments: any[]; installmentPlan: any[] | null; reviewComment: string | null;
  reviewerId: string | null; reviewAt: string | null;
};

export default function ContractDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<Contract>(`/api/contracts/${id}`);
  const [comment, setComment] = useState("");
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/contracts")} title="合同详情" />
        <EmptyState loading />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const status = data.status;

  const callAction = async (path: string, body: any = {}) => {
    const res = await fetch(`/api/contracts/${id}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (j.code !== 0) { message.error(j.message); return false; }
    message.success("操作成功"); await mutate(); return true;
  };
  const askComment = (label: string, path: string) => {
    Modal.confirm({
      title: label,
      content: <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="备注（可选）" />,
      onOk: async () => { await callAction(path, { comment }); setComment(""); }
    });
  };

  return (
    <Page>
      <PageHeader
        back={() => router.push("/contracts")}
        title={`${data.title} · ${data.contractNo}`}
        subtitle={`客户: ${data.customerName} · 服务类型: ${data.serviceType}`}
        meta={<StatusTag status={data.status} domain="contract" />}
        actions={
          <Space>
            {status === "DRAFT" && <Button onClick={() => router.push(`/contracts/${id}/edit`)}>编辑</Button>}
            {status === "DRAFT" && <Button type="primary" onClick={() => callAction("submit")}>提交审批</Button>}
            {status === "PENDING_REVIEW" && roleCode !== "ADMIN" && <Button onClick={() => callAction("withdraw")}>撤回</Button>}
            {status === "PENDING_REVIEW" && roleCode === "ADMIN" && (
              <>
                <Button danger onClick={() => askComment("驳回合同", "reject")}>驳回</Button>
                <Button type="primary" onClick={() => callAction("approve")}>批准</Button>
              </>
            )}
            {(status === "EFFECTIVE" || status === "EXECUTING") && roleCode === "ADMIN" && (
              <Button danger onClick={() => askComment("终止合同", "terminate")}>终止</Button>
            )}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<Contract> column={2} dataSource={data} columns={[
          { title: "合同号", dataIndex: "contractNo" }, { title: "客户", dataIndex: "customerName" },
          { title: "服务类型", dataIndex: "serviceType" },
          { title: "签订日期", dataIndex: "signDate", valueType: "dateTime" },
          { title: "服务起期", dataIndex: "startDate", valueType: "dateTime" },
          { title: "服务止期", dataIndex: "endDate", valueType: "dateTime" },
          { title: "付款方式", dataIndex: "paymentMethod" },
          { title: "合同总额（含税）", dataIndex: "totalAmount", render: (v: any) => `¥${v}` },
          { title: "税率", dataIndex: "taxRate", render: (v: any) => `${(Number(v) * 100).toFixed(2)}%` },
          { title: "税额", dataIndex: "taxAmount", render: (v: any) => `¥${v}` },
          { title: "不含税金额", dataIndex: "amountExcludingTax", render: (v: any) => `¥${v}` },
          { title: "审批人", dataIndex: "reviewerId" },
          { title: "审批时间", dataIndex: "reviewAt", valueType: "dateTime" },
          { title: "审批意见", dataIndex: "reviewComment" }
        ]} />
      </ProCard>
      <ProCard title="附件">
        {(data.attachments ?? []).length === 0 ? <div style={{ color: "var(--qt-text-3)" }}>暂无附件</div> : (
          <ul>{(data.attachments ?? []).map((a: any) => (
            <li key={a.id}>{a.name} <span style={{ color: "var(--qt-text-3)", fontSize: 12 }}>({a.mimeType} · {Math.round((a.size ?? 0) / 1024)} KB)</span></li>
          ))}</ul>
        )}
      </ProCard>
    </Page>
  );
}
