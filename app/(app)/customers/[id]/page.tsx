"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { App as AntdApp } from "antd";
import { Button, Col, Empty, Input, Popover, Row, Space, Tabs } from "antd";
import { FilePdfOutlined } from "@ant-design/icons";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { StatGrid } from "@/components/stat-grid";
import { StatusTag } from "@/components/status-tag";
import { useDict } from "@/lib/dict-client";
import { CurrencyCell, DateCell, DateTimeCell } from "@/components/table-cells";
import { openPrintWindow } from "@/lib/print-client";
import { useResponsive } from "@/lib/use-breakpoint";
import { getAllowedTransitions, isCustomerStatus } from "@/lib/customer-status-transitions";
import type { CustomerStatus } from "@/types/enums";

type Customer = {
  id: string; code: string; name: string; shortName: string | null;
  unifiedSocialCreditCode: string | null; customerType: string; industry: string | null; sourceChannel: string | null;
  scale: string | null; status: string;
  contactName: string | null; contactTitle: string | null; contactPhone: string;
  province: string; city: string; district: string | null; town: string | null; address: string | null;
  createdAt: string;
};

type Overview = {
  contracts: Array<{ id: string; contractNo: string; title: string; status: string; serviceType: string; signDate: string; totalAmount: string }>;
  invoices: Array<{ id: string; invoiceNo: string; status: string; amount: string; actualIssueDate: string | null; contractNo: string }>;
  payments: Array<{ id: string; paymentNo: string; status: string; amount: string; receiveDate: string; contractNo: string }>;
  totals: { contractCount: number; invoiceCount: number; paymentCount: number; contractTotal: number; invoicedTotal: number; paidTotal: number };
};

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/customers");
  const { isMobile } = useResponsive();
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const scaleDict = useDict("CUSTOMER_SCALE");
  const { data, error, isLoading, mutate } = useSWR<Customer>(`/api/customers/${id}`);
  const { data: overview } = useSWR<Overview>(`/api/customers/${id}/overview`);
  const [activeTab, setActiveTab] = useState("info");
  // 状态变更 Popover 状态
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  // 从消息点击 ?suggest=<status> 进入时, 详情页高亮该目标
  const searchParams = useSearchParams();
  const suggestParam = searchParams.get("suggest");
  const fromQuery = isCustomerStatus(suggestParam) ? suggestParam : null;
  // 先看 URL, 没有再看 sessionStorage (持久化高亮, 30 分钟内有效)
  const [persistedHighlight, setPersistedHighlight] = useState<CustomerStatus | null>(null);
  useEffect(() => {
    if (fromQuery) {
      writeSuggestHighlight(id, fromQuery);
      setPersistedHighlight(fromQuery);
      return;
    }
    setPersistedHighlight(readSuggestHighlight(id));
  }, [id, fromQuery]);
  const highlightStatus = fromQuery ?? persistedHighlight;

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="客户详情" />
        <div style={{ marginTop: 12 }}>
          <ErrorBox title="加载失败" action={<Button size="small" onClick={() => mutate()}>重试</Button>}>
            {(error as Error).message}
          </ErrorBox>
        </div>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={goBack} title="客户详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const typeLabel = customerType.find((d) => d.code === data.customerType)?.label ?? data.customerType;
  const industryLabel = data.industry ? (industryDict.find((d) => d.code === data.industry)?.label ?? data.industry) : "—";
  const sourceLabel = data.sourceChannel ? (sourceDict.find((d) => d.code === data.sourceChannel)?.label ?? data.sourceChannel) : "—";
  const scaleLabel = data.scale ? (scaleDict.find((d) => d.code === data.scale)?.label ?? data.scale) : "—";
  const t = overview?.totals;
  const fmtWan = (v: number) => (v / 10000).toFixed(1);

  const tabItems = [
    {
      key: "info",
      label: <span>概览 ({overview?.totals.contractCount ?? 0} 合同)</span>,
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <StatGrid
              columns={4}
              items={[
                { label: "合同数", value: t?.contractCount ?? 0, suffix: "份" },
                { label: "合同总额", value: t ? fmtWan(t.contractTotal) : 0, suffix: "万" },
                { label: "开票总额", value: t ? fmtWan(t.invoicedTotal) : 0, suffix: "万" },
                { label: "回款总额", value: t ? fmtWan(t.paidTotal) : 0, suffix: "万" }
              ]}
            />
          </Col>
        </Row>
      )
    },
    {
      key: "basic",
      label: "基本信息",
      children: (
        <ProCard>
          <ProDescriptions<Customer> column={DESC_COL} dataSource={data} columns={[
            { title: "客户编号", dataIndex: "code" },
            { title: "客户名称", dataIndex: "name" },
            { title: "简称", dataIndex: "shortName", render: (v) => v || "—" },
            { title: "统一社会信用代码", dataIndex: "unifiedSocialCreditCode", render: (v) => v || "—" },
            { title: "客户类型", dataIndex: "customerType", render: () => typeLabel },
            { title: "行业", dataIndex: "industry", render: () => industryLabel },
            { title: "来源渠道", dataIndex: "sourceChannel", render: () => sourceLabel },
            { title: "规模", dataIndex: "scale", render: () => scaleLabel },
            { title: "联系人", dataIndex: "contactName", render: (v) => v || "—" },
            { title: "职务", dataIndex: "contactTitle", render: (v) => v || "—" },
            { title: "联系电话", dataIndex: "contactPhone" },
            { title: "所在省", dataIndex: "province" },
            { title: "所在市", dataIndex: "city" },
            { title: "所在区", dataIndex: "district", render: (v) => v || "—" },
            { title: "所在镇街", dataIndex: "town", render: (v) => v || "—" },
            { title: "详细地址", dataIndex: "address", render: (v) => v || "—", valueType: "textarea" },
            { title: "状态", dataIndex: "status", render: (_, r) => <StatusTag status={r.status as string} domain="customer" /> },
            { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime", render: (_, r) => <DateTimeCell value={r.createdAt as string} /> }
          ]} />
        </ProCard>
      )
    },
    {
      key: "contracts",
      label: <span>合同 ({overview?.contracts.length ?? 0})</span>,
      children: (
        <ProCard>
          <ProTable
            rowKey="id"
            search={false}
            options={false}
            pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
            dataSource={overview?.contracts ?? []}
            scroll={{ x: 'max-content' }}
            sticky={isMobile}
            onRow={(r) => ({ onClick: () => router.push(`/contracts/${r.id}`), style: { cursor: "pointer" } })}
            columns={[
              { title: "合同号", dataIndex: "contractNo", width: 180 },
              { title: "标题", dataIndex: "title" },
              { title: "服务类型", dataIndex: "serviceType", width: 100 },
              { title: "签订日", dataIndex: "signDate", width: 120, render: (_, r) => <DateCell value={r.signDate as string} /> },
              { title: "总额", dataIndex: "totalAmount", width: 140, render: (_, r) => <CurrencyCell value={r.totalAmount as string} /> },
              { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="contract" /> }
            ]} />
        </ProCard>
      )
    },
    {
      key: "invoices",
      label: <span>开票 ({overview?.invoices.length ?? 0})</span>,
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
                { title: "所属合同", dataIndex: "contractNo", width: 180 },
                { title: "金额", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount as string} /> },
                { title: "开票日", dataIndex: "actualIssueDate", width: 120, render: (v) => v ? <DateCell value={v as string} /> : "—" },
                { title: "状态", dataIndex: "status", width: 120, render: (_, r) => <StatusTag status={r.status as string} domain="invoice" /> }
              ]} />
          ) : <Empty description="该客户暂无开票记录" />}
        </ProCard>
      )
    },
    {
      key: "payments",
      label: <span>回款 ({overview?.payments.length ?? 0})</span>,
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
                { title: "所属合同", dataIndex: "contractNo", width: 180 },
                { title: "金额", dataIndex: "amount", width: 140, render: (_, r) => <CurrencyCell value={r.amount as string} /> },
                { title: "到账日", dataIndex: "receiveDate", width: 120, render: (_, r) => <DateCell value={r.receiveDate as string} /> },
                { title: "状态", dataIndex: "status", width: 120, render: (_, r) => <StatusTag status={r.status as string} domain="payment" /> }
              ]} />
          ) : <Empty description="该客户暂无回款记录" />}
        </ProCard>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`${data.name} (${data.code})`}
        subtitle="客户 360 度视图 — 概览 / 信息 / 合同 / 项目 / 开票 / 回款"
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/customers/${id}/pdf`)}>导出 PDF</Button>
<ChangeStatusPopover
              customerId={id}
              currentStatus={data.status}
              highlightStatus={highlightStatus}
              open={statusPopoverOpen}
              onOpenChange={setStatusPopoverOpen}
              onChanged={() => mutate()}
            />
            <Button key="edit" type="primary" onClick={() => router.push(`/customers/${id}/edit`)}>
              编辑
            </Button>
          </Space>
        }
        meta={data.status ? <StatusTag status={data.status} domain="customer" /> : null}
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Page>
  );
}

/**
 * 详情页右上角"变更状态" Popover.
 *
 * - 内容来自状态机迁移表的 getAllowedTransitions(currentStatus), 单一事实源
 * - 点击目标后调用同一 PATCH /api/customers/:id 走 changeCustomerStatus
 *   (不会绕过业务校验; 同状态/非法目标前端已过滤)
 * - 来自消息 ?suggest=<status> 时, 对应按钮高亮(轻提示, 不强制)
 */
function ChangeStatusPopover(props: {
  customerId: string;
  currentStatus: string;
  highlightStatus: CustomerStatus | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const { customerId, currentStatus, highlightStatus, open, onOpenChange, onChanged } = props;
  const { message } = AntdApp.useApp();
  const router = useRouter();
  // 暂存"用户点过但还没提交"的目标; 切到 LOST/FROZEN 时显示原因输入
  const [pending, setPending] = useState<CustomerStatus | null>(null);
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const isCurrent = isCustomerStatus(currentStatus);
  const allowed = isCurrent ? getAllowedTransitions(currentStatus) : [];
  const customerStatusLabel = (s: string) => STATUS_LABEL[s] ?? s;
  const needsReason = (s: CustomerStatus) => s === "LOST" || s === "FROZEN";
  const canSubmit = !pending || !needsReason(pending) || reason.trim().length > 0;

  const reset = () => {
    setPending(null);
    setReason("");
  };

  const handlePick = (s: CustomerStatus) => {
    if (needsReason(s)) {
      setPending(s);
    } else {
      // 立即提交 (NEGOTIATING / SIGNED 不需原因)
      void doChange(s, undefined);
    }
  };

  const handleSubmit = () => {
    if (!pending || !canSubmit) return;
    void doChange(pending, needsReason(pending) ? reason.trim() : undefined);
  };

  const doChange = async (target: CustomerStatus, reasonText?: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: target, ...(reasonText ? { reason: reasonText } : {}) })
      });
      const j = await res.json();
      if (j.code !== 0) {
        message.error(j.message ?? "状态变更失败");
        return;
      }
      message.success(`已变更为「${customerStatusLabel(target)}」`);
      // 成功后清除高亮 + 关闭 popover + 刷新数据
      clearSuggestHighlight(customerId);
      onOpenChange(false);
      reset();
      onChanged();
      // 顺手清掉 URL 上的 ?suggest=, 但不在所有客户端 router 上都支持
      try {
        router.replace(`/customers/${customerId}`);
      } catch {
        // 静默
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 240 }}>
      {allowed.length === 0 ? (
        <span style={{ color: "var(--qt-text-faint)", fontSize: 13 }}>当前状态无可去往的目标</span>
      ) : pending ? (
        // 二级面板: 填写原因
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13 }}>
            变更到 <b>{customerStatusLabel(pending)}</b> 需要填写原因
          </div>
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如: 客户明确拒绝 / 内部暂停合作"
            maxLength={200}
            showCount
            autoFocus
            rows={3}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={reset} disabled={submitting} block>取消</Button>
            <Button type="primary" onClick={handleSubmit} disabled={!canSubmit || submitting} loading={submitting} block>
              确认变更
            </Button>
          </div>
        </div>
      ) : (
        // 一级面板: 选目标
        <>
          {highlightStatus && allowed.includes(highlightStatus) && (
            <div
              data-testid="suggest-tip"
              style={{
                fontSize: 12,
                color: "var(--qt-bg-info-text)",
                background: "var(--qt-bg-info)",
                padding: "4px 8px",
                borderRadius: 4
              }}
            >
              来自站内信建议,推荐变更到 <b>{customerStatusLabel(highlightStatus)}</b>
            </div>
          )}
          {allowed.map((s) => {
            const isSuggested = highlightStatus === s;
            return (
              <Button
                key={s}
                type={isSuggested ? "primary" : "default"}
                onClick={() => handlePick(s)}
                block
                data-testid={`change-status-${s}`}
              >
                {customerStatusLabel(s)}
                {isSuggested && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      padding: "0 6px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.25)"
                    }}
                  >
                    建议
                  </span>
                )}
              </Button>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title="变更状态"
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <Button key="changeStatus" data-testid="change-status-trigger">变更状态</Button>
    </Popover>
  );
}

const STATUS_LABEL: Record<string, string> = {
  LEAD: "线索",
  NEGOTIATING: "洽谈中",
  SIGNED: "已签约",
  LOST: "已流失",
  FROZEN: "已冻结"
};

// sessionStorage key: 保留 ?suggest= 的高亮, 刷新页面也能看到
// - 进入详情页 (含 ?suggest=) 时写入
// - 状态变更成功 / 手动 dismiss 时清除
// - 用 sessionStorage 而不是 localStorage, 关闭 tab 自动失效
const SUGGEST_HIGHLIGHT_STORAGE_KEY = "customer-suggest-highlight";

type HighlightRecord = { customerId: string; status: CustomerStatus; at: number };

function readSuggestHighlight(customerId: string): CustomerStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SUGGEST_HIGHLIGHT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HighlightRecord;
    if (parsed.customerId !== customerId) return null;
    if (!isCustomerStatus(parsed.status)) return null;
    // 30 分钟内的建议高亮有效, 避免下次进来还亮着
    if (Date.now() - parsed.at > 30 * 60_000) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

function writeSuggestHighlight(customerId: string, status: CustomerStatus) {
  if (typeof window === "undefined") return;
  const rec: HighlightRecord = { customerId, status, at: Date.now() };
  window.sessionStorage.setItem(SUGGEST_HIGHLIGHT_STORAGE_KEY, JSON.stringify(rec));
}

function clearSuggestHighlight(customerId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(SUGGEST_HIGHLIGHT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as HighlightRecord;
    if (parsed.customerId === customerId) {
      window.sessionStorage.removeItem(SUGGEST_HIGHLIGHT_STORAGE_KEY);
    }
  } catch {
    // 静默
  }
}
