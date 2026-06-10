"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Button, Space, Modal, Input } from "antd";
import { useParams, useRouter } from "next/navigation";
import type { Contract as ContractEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { CurrencyCell, DateTimeCell, PercentCell } from "@/components/table-cells";
import { AttachmentList } from "@/components/file/attachment-list";

const PAYMENT_METHOD_MAP: Record<string, string> = { LUMP_SUM: "一次性", BY_PHASE: "按阶段", BY_MONTH: "按月", BY_QUARTER: "按季" };

export default function ContractDetailPage() {
  const params = useParams();  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<{ data: ContractEntity }>(`/api/contracts/${id}`);
  const contract = data?.data;
  const [comment, setComment] = useState("");
  const { run } = useActionCall({ baseUrl: `/api/contracts/${id}`, reload: () => mutate() });

  if (isLoading || !contract) {
    return (
      <Page>
        <PageHeader back={() => router.push("/contracts")} title="合同详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const status = contract.status;

  const askComment = (label: string, path: string) => {
    Modal.confirm({
      title: label,
      content: <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="备注(可选)" />,
      onOk: async () => { await run(path, { comment }); setComment(""); }
    });
  };

  return (
    <Page>
      <PageHeader
        back={() => router.push("/contracts")}
        title={`${contract.title} · ${contract.contractNo}`}
        subtitle={`客户: ${contract.customerName} · 服务类型: ${contract.serviceType}`}
        meta={<StatusTag status={contract.status} domain="contract" />}
        actions={
          <Space>
            {status === "DRAFT" && <Button onClick={() => router.push(`/contracts/${id}/edit`)}>编辑</Button>}
            {status === "DRAFT" && <Button type="primary" onClick={() => run("submit")}>提交审批</Button>}
            {status === "PENDING_REVIEW" && roleCode !== "ADMIN" && <Button onClick={() => run("withdraw")}>撤回</Button>}
            {status === "PENDING_REVIEW" && roleCode === "ADMIN" && (
              <>
                <Button danger onClick={() => askComment("驳回合同", "reject")}>驳回</Button>
                <Button type="primary" onClick={() => run("approve")}>批准</Button>
              </>
            )}
            {(status === "EFFECTIVE" || status === "EXECUTING") && roleCode === "ADMIN" && (
              <Button danger onClick={() => askComment("终止合同", "terminate")}>终止</Button>
            )}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<ContractEntity> column={2} dataSource={contract} columns={[
          { title: "合同号", dataIndex: "contractNo" },
          { title: "客户", dataIndex: "customerName" },
          { title: "服务类型", dataIndex: "serviceType" },
          { title: "签订日期", dataIndex: "signDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "服务起期", dataIndex: "startDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "服务止期", dataIndex: "endDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "付款方式", dataIndex: "paymentMethod", render: (v) => PAYMENT_METHOD_MAP[v as string] ?? v },
          { title: "合同总额(含税)", dataIndex: "totalAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "税率", dataIndex: "taxRate", render: (v) => <PercentCell value={v as string} /> },
          { title: "税额", dataIndex: "taxAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "不含税金额", dataIndex: "amountExcludingTax", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "审批人", dataIndex: "reviewerId" },
          { title: "审批时间", dataIndex: "reviewAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "审批意见", dataIndex: "reviewComment" }
        ]} />
      </ProCard>
      <PageHeader level="section" title="附件" />
      <ProCard>
        <AttachmentList
          items={(contract.attachments ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            legacyUrl: typeof a.url === "string" ? a.url : undefined
          }))}
          onDeleted={() => mutate()}
        />
      </ProCard>
    </Page>
  );
}
