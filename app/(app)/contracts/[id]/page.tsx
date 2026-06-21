"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { App as AntdApp, Button, Card, Col, Empty, Row, Space, Statistic, Tabs, Tag } from "antd";
import { useParams, useRouter } from "next/navigation";
import type { Contract as ContractEntity } from "@/lib/types/entities";
import type { BillingStatus } from "@/types/enums";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { DeleteOutlined, FilePdfOutlined } from "@ant-design/icons";
import { openPrintWindow } from "@/lib/print-client";
import { CurrencyCell, DateTimeCell, PercentCell } from "@/components/table-cells";
import { AttachmentList } from "@/components/file/attachment-list";
import { useDict } from "@/lib/dict-client";
import { useUserName } from "@/lib/user-lookup";
import { PAYMENT_METHOD_MAP, SERVICE_TYPE_MAP, REVIEW_ACTION_MAP, BILLING_STATUS_MAP } from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";

const REVIEW_ACTION_TONE: Record<string, string> = {
  SUBMIT:    "processing",
  APPROVE:   "success",
  REJECT:    "danger",
  WITHDRAW:  "warning",
  EXECUTE:   "processing",
  SUSPEND:   "warning",
  RESUME:    "processing",
  COMPLETE:  "success"
};

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

type Overview = {
  projects: Array<{ id: string; projectNo: string; name: string; status: string; startDate: string; endDate: string; managerUserId: string; workflowTaskCount: number; workflowCompleted: number }>;
  invoices: Array<{ id: string; invoiceNo: string; status: string; amount: string; applyDate: string; actualIssueDate: string | null }>;
  payments: Array<{ id: string; paymentNo: string; status: string; amount: string; receiveDate: string }>;
  reviewLogs: Array<{ id: string; action: string; reviewerId: string; comment: string | null; at: string }>;
  totals: { projectCount: number; invoiceCount: number; paymentCount: number; totalAmount: number; invoicedAmount: number; paidAmount: number; billingStatus: BillingStatus; workflowTaskCount: number; workflowCompleted: number };
};

function ReviewerName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}

function ProjectManagerName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}

function SignerName({ id }: { id: string | null | undefined }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}

export default function ContractDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data: contract, error, isLoading, mutate } = useSWR<ContractEntity>(`/api/contracts/${id}`);
  const { data: overview } = useSWR<Overview>(`/api/contracts/${id}/overview`);
  const { data: session } = useSession();
  const paymentMethod = useDict("PAYMENT_METHOD");
  const { run } = useActionCall({ baseUrl: `/api/contracts/${id}`, reload: () => mutate() });
  const { message: msg, modal } = AntdApp.useApp();

// admin 删除草稿/待审 合同（后端会再做 admin + 状态 + 子数据 校验）
const handleDelete = () => {
  modal.confirm({
    title: "确认删除该合同？",
    content: "删除后可在回收站恢复，状态为 DRAFT / PENDING_REVIEW 且无项目 / 发票 / 回款 / 附件 时可操作。",
    okButtonProps: { danger: true },
    okText: "删除",
    cancelText: "取消",
    onOk: async () => {
      try {
        const res = await fetch(`/api/contracts/${id}`, { method: "DELETE", credentials: "include" });
        const j = await res.json();
        if (j.code !== 0) { msg.error(j.message); return; }
        msg.success("合同已删除");
        router.push("/contracts");
      } catch (e) {
        msg.error((e as Error).message);
      }
    }
  });
};
  const [activeTab, setActiveTab] = useState("info");

  if (error) {
    return (
      <Page>
        <PageHeader back={() => router.push("/contracts")} title="合同详情" />
        <div style={{ marginTop: 12, padding: 16, background: "#fff2f0", color: "#cf1322", borderRadius: 8, fontSize: 13 }}>
          加载失败: {(error as Error).message}{" "}
          <Button size="small" type="link" onClick={() => mutate()}>重试</Button>
        </div>
      </Page>
    );
  }
  if (isLoading || !contract) {
    return (
      <Page>
        <PageHeader back={() => router.push("/contracts")} title="合同详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const t = overview?.totals;
  const fmtWan = (v: number) => (v / 10000).toFixed(1);

  const can = (() => {
    const s = contract.status;
    if (s === "DRAFT") return ["submit"];
    if (s === "PENDING_REVIEW") return ["approve", "reject", "withdraw"];
    if (s === "EFFECTIVE") return ["execute", "complete", "terminate"];
    if (s === "EXECUTING") return ["suspend", "complete", "terminate"];
    if (s === "SUSPENDED") return ["resume", "complete", "terminate"];
    return [];
  })();
  const isOwnerOrAdmin = (session?.user as { roleCode?: string })?.roleCode === "ADMIN";
  const allowed = isOwnerOrAdmin ? can : [];

  const tabItems = [
    {
      key: "info",
      label: <span>概览 ({t?.projectCount ?? 0} 项目)</span>,
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="合同总额" value={t ? fmtWan(t.totalAmount) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="已开票" value={t ? fmtWan(t.invoicedAmount) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="已回款" value={t ? fmtWan(t.paidAmount) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card>
              <Statistic
                title="工作流完成率"
                value={t && t.workflowTaskCount > 0 ? Math.round((t.workflowCompleted / t.workflowTaskCount) * 100) : 0}
                suffix="%"
                
              />
            </Card>
          </Col>
          <Col xs={24}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#666" }}>开票状态</span>
                <Tag
                  color={t?.billingStatus === "COMPLETED" ? "success" : t?.billingStatus === "IN_PROGRESS" ? "processing" : "default"}
                  style={{ fontSize: 14, padding: "4px 12px" }}
                >
                  {BILLING_STATUS_MAP[t?.billingStatus ?? "NOT_STARTED"] ?? t?.billingStatus}
                </Tag>
                <span style={{ fontSize: 13, color: "#999" }}>
                  已开票 {t ? fmtWan(t.invoicedAmount) : 0} 万 / 合同总额 {t ? fmtWan(t.totalAmount) : 0} 万
                </span>
              </div>
            </Card>
          </Col>
          <Col xs={24}>
            <ProCard>
              <Row gutter={16}>
                <Col xs={8}><Statistic title="项目数" value={t?.projectCount ?? 0} /></Col>
                <Col xs={8}><Statistic title="开票数" value={t?.invoiceCount ?? 0} /></Col>
                <Col xs={8}><Statistic title="回款数" value={t?.paymentCount ?? 0} /></Col>
              </Row>
            </ProCard>
          </Col>
        </Row>
      )
    },
    {
      key: "basic",
      label: "详细信息",
      children: (
        <ProCard>
          <ProDescriptions<ContractEntity> column={DESC_COL} dataSource={contract} columns={[
            { title: "合同编号", dataIndex: "contractNo" },
            { title: "标题", dataIndex: "title" },
            { title: "客户", dataIndex: "customerName" },
            { title: "服务类型", dataIndex: "serviceType", render: (v) => SERVICE_TYPE_MAP[v as string] ?? v },
            { title: "签订日", dataIndex: "signDate", valueType: "date", render: (_, r) => <DateTimeCell value={r.signDate as string} /> },
            { title: "起期", dataIndex: "startDate", valueType: "date", render: (_, r) => <DateTimeCell value={r.startDate as string} /> },
            { title: "止期", dataIndex: "endDate", valueType: "date", render: (_, r) => <DateTimeCell value={r.endDate as string} /> },
            { title: "合同总额", dataIndex: "totalAmount", render: (_, r) => <CurrencyCell value={r.totalAmount as string} /> },
            // 税率是 fraction (0.06);PercentCell 内部 v*100 → "6.00%",这里不能再 *100 否则变成 600.00%
            { title: "税率", dataIndex: "taxRate", render: (_, r) => <PercentCell value={r.taxRate as string} /> },
            { title: "税额", dataIndex: "taxAmount", render: (_, r) => <CurrencyCell value={r.taxAmount as string} /> },
            { title: "不含税金额", dataIndex: "amountExcludingTax", render: (_, r) => <CurrencyCell value={r.amountExcludingTax as string} /> },
            { title: "付款方式", dataIndex: "paymentMethod", render: (v) => PAYMENT_METHOD_MAP[v as string] ?? paymentMethod.find((d) => d.code === v)?.label ?? v },
            { title: "签订人", dataIndex: "signerId", render: (_, r) => <SignerName id={r.signerId as string | null} /> },
            { title: "状态", dataIndex: "status", render: (_, r) => <StatusTag status={r.status as string} domain="contract" /> }
          ]} />
        </ProCard>
      )
    },
    {
      key: "projects",
      label: <span>项目 ({t?.projectCount ?? 0})</span>,
      children: (
        <ProCard>
          {overview && overview.projects.length > 0 ? (
            <ProTable
              rowKey="id"
              search={false}
              options={false}
              pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
              dataSource={overview.projects}
              scroll={{ x: 'max-content' }}
              sticky={isMobile}
              onRow={(r) => ({ onClick: () => router.push(`/projects/${r.id}`), style: { cursor: "pointer" } })}
              columns={[
                { title: "项目编号", dataIndex: "projectNo", width: 180 },
                { title: "项目名称", dataIndex: "name" },
                { title: "起期", dataIndex: "startDate", width: 120, render: (_, r) => <DateTimeCell value={r.startDate as string} /> },
                { title: "止期", dataIndex: "endDate", width: 120, render: (_, r) => <DateTimeCell value={r.endDate as string} /> },
                { title: "负责人", dataIndex: "managerUserId", width: 100, render: (_, r) => <ProjectManagerName id={r.managerUserId as string} /> },
                { title: "工作流", dataIndex: "workflowTaskCount", width: 140, render: (_, r) => (
                  <Tag color={r.workflowCompleted === r.workflowTaskCount ? "success" : "processing"}>
                    {r.workflowCompleted}/{r.workflowTaskCount}
                  </Tag>
                ) },
                { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="project" /> }
              ]} />
          ) : <Empty description="本合同暂无项目" />}
        </ProCard>
      )
    },
    {
      key: "invoices",
      label: <span>开票 ({t?.invoiceCount ?? 0})</span>,
      children: (
        <ProCard>
          {overview && overview.invoices.length > 0 ? (
            <ProTable
              rowKey="id"
              search={false}
              options={false}
              pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
              dataSource={overview.invoices}
              scroll={{ x: 'max-content' }}
              sticky={isMobile}
              onRow={(r) => ({ onClick: () => router.push(`/invoices/${r.id}`), style: { cursor: "pointer" } })}
              columns={[
                { title: "发票号", dataIndex: "invoiceNo", width: 180 },
                { title: "金额", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount as string} /> },
                { title: "申请日", dataIndex: "applyDate", width: 140, render: (_, r) => <DateTimeCell value={r.applyDate as string} /> },
                { title: "开票日", dataIndex: "actualIssueDate", width: 140, render: (v) => v ? <DateTimeCell value={v as string} /> : "—" },
                { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="invoice" /> }
              ]} />
          ) : <Empty description="本合同暂无开票" />}
        </ProCard>
      )
    },
    {
      key: "payments",
      label: <span>回款 ({t?.paymentCount ?? 0})</span>,
      children: (
        <ProCard>
          {overview && overview.payments.length > 0 ? (
            <ProTable
              rowKey="id"
              search={false}
              options={false}
              pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
              dataSource={overview.payments}
              scroll={{ x: 'max-content' }}
              sticky={isMobile}
              onRow={(r) => ({ onClick: () => router.push(`/payments/${r.id}`), style: { cursor: "pointer" } })}
              columns={[
                { title: "回款单号", dataIndex: "paymentNo", width: 180 },
                { title: "金额", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount as string} /> },
                { title: "到账日", dataIndex: "receiveDate", width: 140, render: (_, r) => <DateTimeCell value={r.receiveDate as string} /> },
                { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="payment" /> }
              ]} />
          ) : <Empty description="本合同暂无回款" />}
        </ProCard>
      )
    },
    {
      key: "review",
      label: <span>审批记录 ({overview?.reviewLogs.length ?? 0})</span>,
      children: (
        <ProCard>
          {overview && overview.reviewLogs.length > 0 ? (
            <ProTable
              rowKey="id"
              search={false}
              options={false}
              pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
              dataSource={overview.reviewLogs}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: "时间", dataIndex: "at", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.at as string} /> },
                { title: "动作", dataIndex: "action", width: 120, render: (v) => <Tag color={REVIEW_ACTION_TONE[v as string] ?? "default"}>{REVIEW_ACTION_MAP[v as string] ?? v}</Tag> },
                { title: "审批人", dataIndex: "reviewerId", width: 120, render: (_, r) => <ReviewerName id={r.reviewerId as string} /> },
                { title: "意见", dataIndex: "comment", render: (v) => v || "—" }
              ]} />
          ) : <Empty description="本合同暂无审批记录" />}
        </ProCard>
      )
    },
    {
      key: "attachments",
      label: "附件",
      children: (
        <ProCard>
          <AttachmentList
              items={(contract.attachments ?? []).map((a) => ({
                id: a.id,
                name: a.name,
                mimeType: a.mimeType,
                size: a.size,
                // 历史数据 url 可能是 /upload/xxx 相对路径, 传 legacyUrl 让附件列表显示"历史链接已失效"标签
                // (当前 DB 已无 legacy 条目, 此处为防御性: 若以后又混进 legacy 数据, 至少不再让用户点坏按钮)
                legacyUrl: typeof a.url === "string" ? a.url : undefined
              }))}
              allowDelete={isOwnerOrAdmin}
            />
        </ProCard>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        back={() => router.push("/contracts")}
        title={`${contract.title} · ${contract.contractNo}`}
        subtitle="合同 360 度视图 — 概览 / 信息 / 项目 / 开票 / 回款 / 审批 / 附件"
        meta={<StatusTag status={contract.status} domain="contract" />}
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/contracts/${id}/pdf`)}>导出 PDF</Button>
            {["DRAFT", "PENDING_REVIEW", "SUSPENDED"].includes(contract.status) && (
              <Button onClick={() => router.push(`/contracts/${id}/edit`)}>编辑</Button>
            )}
            {allowed.map((a) => (
              <Button
                key={a}
                type={a === "cancel" ? "default" : "primary"}
                danger={a === "reject" || a === "terminate"}
                onClick={() => run(a)}
              >
                {a === "submit" ? "提交审批" : a === "approve" ? "批准" : a === "reject" ? "驳回" : a === "withdraw" ? "撤回" : a === "execute" ? "开始执行" : a === "complete" ? "结清" : a === "suspend" ? "暂停" : a === "resume" ? "恢复" : a === "terminate" ? "终止" : a}
              </Button>
            ))}
            {isOwnerOrAdmin && (
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                删除
              </Button>
            )}
          </Space>
        }
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Page>
  );
}
