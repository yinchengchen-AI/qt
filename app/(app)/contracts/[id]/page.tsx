"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Alert, App as AntdApp, Button, Card, Col, Empty, Radio, Row, Space, Statistic, Tabs, Tag } from "antd";
import { CloudUploadOutlined, DeleteOutlined, FilePdfOutlined } from "@ant-design/icons";
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
import { openPrintWindow } from "@/lib/print-client";
import { CurrencyCell, DateTimeCell, PercentCell } from "@/components/table-cells";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { proCustomRequest } from "@/lib/upload-client";
import { useDict } from "@/lib/dict-client";
import { useUserName } from "@/lib/user-lookup";
import { PAYMENT_METHOD_MAP, SERVICE_TYPE_MAP, REVIEW_ACTION_MAP, BILLING_STATUS_MAP } from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";
import { useT } from "@/lib/i18n";

const REVIEW_ACTION_TONE: Record<string, string> = {
  // 旧
  SUBMIT:    "processing",
  APPROVE:   "success",
  REJECT:    "danger",
  WITHDRAW:  "warning",
  EXECUTE:   "processing",
  SUSPEND:   "warning",
  RESUME:    "processing",
  COMPLETE:  "success",
  // 新: 自动用蓝色, 手动用 default
  AUTO_PUBLISH:           "blue",
  MANUAL_PUBLISH:         "default",
  AUTO_CLOSE_COMPLETED:   "blue",
  AUTO_CLOSE_EXPIRED:     "blue",
  AUTO_CLOSE_TERMINATED:  "blue",
  MANUAL_CLOSE:           "default"
};

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

type DeliverableAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};

type Overview = {
  // 合同结构化交付物 (JSON 清单) 已下线; 留空数组做兼容占位
  deliverables: Array<{ id: string; name: string; type?: string; dueDate?: string; quantity?: number; unit?: string; remark?: string }>;
  // 合同交付物附件 (扁平列表, 仅 isDeliverable=true 的附件); 详情 tab 内上传
  deliverableAttachments: DeliverableAttachment[];
  invoices: Array<{ id: string; invoiceNo: string; status: string; amount: string; applyDate: string; actualIssueDate: string | null }>;
  payments: Array<{ id: string; paymentNo: string; status: string; amount: string; receiveDate: string }>;
  reviewLogs: Array<{ id: string; action: string; reviewerId: string; comment: string | null; at: string }>;
  totals: { invoiceCount: number; paymentCount: number; totalAmount: number; invoicedAmount: number; paidAmount: number; billingStatus: BillingStatus };
};

// 交付物附件写权限: admin / 合同签订人 / 合同负责人
// 跟 server/storage/presign.ts: assertCanManageDeliverables 行为一致
function useCanManageContractDeliverables(contract: ContractEntity | undefined): boolean {
  const { data: session } = useSession();
  const role = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  if (role === "ADMIN") return true;
  const me = (session?.user as { id?: string } | undefined)?.id;
  if (!me || !contract) return false;
  return contract.signerId === me || contract.ownerUserId === me;
}

function ReviewerName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}

function SignerName({ id }: { id: string | null | undefined }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}

// 合同交付物 tab: 合同实际交付的文件 (报告 / 证书 / 培训材料 等) 全部在详情页内上传
// 不再有结构化清单; canManage 控制上传 / 删除按钮 (admin / 合同签订人 / 合同负责人)
function DeliverablesTab({
  id,
  contract,
  overview,
  onRefresh
}: {
  id: string;
  contract: ContractEntity;
  overview: Overview | undefined;
  onRefresh: () => void;
}) {
  const t = useT();
  const { message } = AntdApp.useApp();
  const canManage = useCanManageContractDeliverables(contract);
  const attachments = overview?.deliverableAttachments ?? [];

  const items: AttachmentItem[] = attachments.map((a) => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size
  }));

  const handleDelete = async (item: AttachmentItem) => {
    const res = await fetch(`/api/files/${item.id}`, { method: "DELETE", credentials: "include" });
    const j = await res.json();
    if (j.code !== 0) throw new Error(j.message || "删除失败");
    void message.success("已删除");
    onRefresh();
  };

  // 交付物附件上传: 包一层 customRequest, 完成后调 onRefresh 刷新列表
  // antd Upload 的 options 类型较复杂, 用 unknown 接收再窄化为最小子集; proCustomRequest 内部用 any 透传
  const customRequest = (options: unknown): void => {
    const opts = options as { file?: File; onSuccess?: (response: unknown) => void; onError?: (err: Error) => void };
    const file = opts?.file;
    if (!file) {
      opts?.onError?.(new Error("空文件"));
      return;
    }
    const inner = proCustomRequest({ contractId: id, isDeliverable: true });
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          // 包装 onSuccess/onError, 走完之后调外层回调
          inner({
            file,
            onSuccess: (res: unknown) => { opts?.onSuccess?.(res); resolve(); },
            onError: (err: Error) => { opts?.onError?.(err); reject(err); }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 透传给 proCustomRequest (内部用 any options)
          } as any);
        });
        void message.success("已上传");
        onRefresh();
      } catch (e) {
        void message.error((e as Error).message || "上传失败");
      }
    })();
  };

  return (
    <ProCard>
      {!canManage ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("contract.deliverable.manageHint")}
        />
      ) : null}
      <AttachmentList
        items={items}
        allowDelete={canManage}
        allowPreview
        showHeader={items.length > 0}
        emptyText={t("contract.deliverable.emptyAttachments")}
        customDelete={handleDelete}
      />
      {canManage ? (
        <div style={{ marginTop: 12 }}>
          <UploadButton
            name="deliverable_upload"
            label={
              <Space size={4}>
                <CloudUploadOutlined />
                <span>{t("contract.deliverable.uploadHint")}</span>
              </Space>
            }
            max={20}
            fieldProps={{
              name: "file",
              customRequest
            }}
          />
        </div>
      ) : null}
    </ProCard>
  );
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
    content: "删除后可在回收站恢复，状态为 DRAFT 且无发票 / 回款 / 附件 时可操作。",
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
  // 强制完结弹窗: admin 选 reason (completed / terminated / expired)
  const [closeReason, setCloseReason] = useState<"completed" | "terminated" | "expired">("completed");

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

  // 状态机 3 态: DRAFT/ACTIVE/CLOSED. 业务基本无需手动操作, 自动化处理常见流转;
  // 这里只暴露 admin 兜底入口: DRAFT 强制发布, ACTIVE 强制完结.
  const can = (() => {
    const s = contract.status;
    if (s === "DRAFT") return ["publish"];
    if (s === "ACTIVE") return ["close"];
    return [];
  })();
  const handleClose = async () => {
    try {
      const res = await fetch(`/api/contracts/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: closeReason })
      });
      const j = await res.json();
      if (j.code !== 0) { msg.error(j.message); return; }
      msg.success("合同已完结");
      mutate();
    } catch (e) {
      msg.error((e as Error).message);
    }
  };
  const askClose = () => {
    modal.confirm({
      title: "强制完结合同",
      content: (
        <div style={{ paddingTop: 8 }}>
          <div style={{ marginBottom: 8 }}>请选择完结原因 (记录到 reviewComment):</div>
          <Radio.Group value={closeReason} onChange={(e) => setCloseReason(e.target.value)}>
            <Radio value="completed">提前结清 (completed)</Radio>
            <Radio value="terminated">业务终止 (terminated)</Radio>
            <Radio value="expired">到期兜底 (expired)</Radio>
          </Radio.Group>
        </div>
      ),
      okText: "确认完结",
      cancelText: "取消",
      onOk: handleClose
    });
  };
  const me = (session?.user as { id?: string } | undefined)?.id;
  const isAdmin = (session?.user as { roleCode?: string })?.roleCode === "ADMIN";
  const canManageAttachments =
    isAdmin || (!!me && (contract.ownerUserId === me || contract.signerId === me));
  const allowed = isAdmin ? can : [];

  const tabItems = [
    {
      key: "info",
      label: <span>概览</span>,
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
                <Col xs={12}><Statistic title="开票数" value={t?.invoiceCount ?? 0} /></Col>
                <Col xs={12}><Statistic title="回款数" value={t?.paymentCount ?? 0} /></Col>
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
            { title: "负责人", dataIndex: "ownerUserId", render: (_, r) => r.ownerName || "—" },
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
            // 备注: 自由文本, 可能很长 -> ProDescriptions 默认会换行; 跟 reviewComment (审批意见) 区分
            { title: "备注", dataIndex: "remark", render: (v) => v || "—" },
            { title: "状态", dataIndex: "status", render: (_, r) => <StatusTag status={r.status as string} domain="contract" /> }
          ]} />
        </ProCard>
      )
    },
    {
      key: "deliverables",
      label: <span>交付物 ({overview?.deliverableAttachments.length ?? 0})</span>,
      children: <DeliverablesTab id={id} contract={contract} overview={overview} onRefresh={mutate} />
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
      label: <span>状态记录 ({overview?.reviewLogs.length ?? 0})</span>,
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
          ) : <Empty description="本合同暂无状态变更记录" />}
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
            allowDelete={canManageAttachments}
            onDeleted={() => mutate()}
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
            {(isAdmin || contract.status === "DRAFT") && (
              <Button onClick={() => router.push(`/contracts/${id}/edit`)}>编辑</Button>
            )}
            {allowed.map((a) => (
              <Button
                key={a}
                type="primary"
                onClick={a === "close" ? askClose : () => run(a)}
              >
                {a === "publish" ? "发布" : a === "close" ? "完结" : a}
              </Button>
            ))}
            {isAdmin && (
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
