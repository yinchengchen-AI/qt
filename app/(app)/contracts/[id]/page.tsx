"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space, Modal, Input, Tag } from "antd";
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
import { FilePdfOutlined } from "@ant-design/icons";
import { openPrintWindow } from "@/lib/print-client";
import { CurrencyCell, DateTimeCell, PercentCell } from "@/components/table-cells";
import { AttachmentList } from "@/components/file/attachment-list";
import { useDict } from "@/lib/dict-client";
import { useUserName } from "@/lib/user-lookup";
import { PAYMENT_METHOD_MAP, SERVICE_TYPE_MAP, REVIEW_ACTION_MAP } from "@/lib/enum-maps";

const REVIEW_ACTION_TONE: Record<string, string> = {
  SUBMIT:    "processing",
  APPROVE:   "success",
  REJECT:    "danger",
  WITHDRAW:  "warning"
};

export default function ContractDetailPage() {
  const params = useParams();  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<ContractEntity>(`/api/contracts/${id}`);
  const contract = data;
  const [comment, setComment] = useState("");
  const { run } = useActionCall({ baseUrl: `/api/contracts/${id}`, reload: () => mutate() });
  const serviceTypeDict = useDict("SERVICE_TYPE");
  const serviceTypeLabel = serviceTypeDict.find((d) => d.code === contract?.serviceType)?.label ?? SERVICE_TYPE_MAP[contract?.serviceType ?? ""] ?? contract?.serviceType ?? "";

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
        subtitle={`客户: ${contract.customerName} · 服务类型: ${serviceTypeLabel}`}
        meta={<StatusTag status={contract.status} domain="contract" />}
        actions={
          <Space>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/contracts/${id}/pdf`)}>导出 PDF</Button>
            {status === "DRAFT" && (
              <>
                <Button onClick={() => router.push(`/contracts/${id}/edit`)}>编辑</Button>
                <Button type="primary" onClick={() => run("submit")}>提交审批</Button>
              </>
            )}
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
          { title: "服务类型", dataIndex: "serviceType", render: () => serviceTypeLabel },
          { title: "签订日期", dataIndex: "signDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "服务起期", dataIndex: "startDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "服务止期", dataIndex: "endDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "付款方式", dataIndex: "paymentMethod", render: (v) => PAYMENT_METHOD_MAP[v as string] ?? v },
          { title: "合同总额(含税)", dataIndex: "totalAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "税率", dataIndex: "taxRate", render: (v) => <PercentCell value={v as string} /> },
          { title: "税额", dataIndex: "taxAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "不含税金额", dataIndex: "amountExcludingTax", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "审批人", dataIndex: "reviewerId", render: (v) => v ? <ReviewerName id={v as string} /> : "—" },
          { title: "审批时间", dataIndex: "reviewAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "审批意见", dataIndex: "reviewComment" }
        ]} />
      </ProCard>
      <PageHeader level="section" title="审批记录" />
      <ProCard>
        {contract.reviewLogs && contract.reviewLogs.length > 0 ? (
          <ProTable
            rowKey="id"
            search={false}
            options={false}
            pagination={false}
            dataSource={contract.reviewLogs}
            columns={[
              {
                title: "时间",
                dataIndex: "at",
                width: 180,
                render: (_, r) => <DateTimeCell value={r.at} />
              },
              {
                title: "动作",
                dataIndex: "action",
                width: 120,
                render: (_, r) => (
                  <Tag color={REVIEW_ACTION_TONE[r.action] ?? "default"}>
                    {REVIEW_ACTION_MAP[r.action] ?? r.action}
                  </Tag>
                )
              },
              {
                title: "操作人",
                dataIndex: "reviewerName",
                width: 140,
                render: (_, r) => r.reviewerName || "—"
              },
              {
                title: "备注",
                dataIndex: "comment",
                render: (_, r) => r.comment || <span style={{ color: "#9CA3AF" }}>—</span>
              }
            ]}
          />
        ) : (
          <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: "16px 0" }}>
            暂无审批记录
          </div>
        )}
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

// 审批人 ID 解析为姓名;抽成组件是因为 useUserName 必须在 hook 顶层调用
function ReviewerName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}
