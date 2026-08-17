"use client";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid } from "@/components/stat-grid";
import { ProTable } from "@ant-design/pro-components";
import { Button, App as AntdApp, Drawer, Space, Tag, Descriptions, List, Modal, Input } from "antd";
import { UploadOutlined, SyncOutlined, CloseOutlined, EyeOutlined } from "@ant-design/icons";
import { useResponsive } from "@/lib/use-breakpoint";
import { useActionCall } from "@/lib/use-action-call";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useListRequest } from "@/lib/use-list-request";

// 对账状态映射
const MATCH_STATUS_MAP: Record<string, { label: string; color: string }> = {
  UNMATCHED: { label: "待匹配", color: "default" },
  AUTO_MATCHED: { label: "自动匹配", color: "processing" },
  CONFIRMED_MATCHED: { label: "已确认", color: "success" },
  MANUAL_MATCHED: { label: "手动匹配", color: "success" },
  IGNORED: { label: "已忽略", color: "warning" },
};

const SEVERITY_MAP: Record<string, { label: string; color: string }> = {
  LOW: { label: "低", color: "default" },
  MEDIUM: { label: "中", color: "warning" },
  HIGH: { label: "高", color: "danger" },
  CRITICAL: { label: "严重", color: "danger" },
};

const DISCREPANCY_TYPE_MAP: Record<string, string> = {
  AMOUNT_MISMATCH: "金额不符",
  DUPLICATE_REF: "重复流水",
  UNMATCHED_TRANSACTION: "未匹配流水",
  OVER_PAYMENT: "超额回款",
  UNDER_PAYMENT: "回款不足",
};

type BankTransactionRow = {
  id: string;
  bankRefNo: string;
  transactionDate: string;
  amount: string;
  counterpartyName?: string;
  summary?: string;
  matchStatus: string;
  matchScore?: number;
  matchReason?: string;
  payment?: {
    id: string;
    paymentNo: string;
    amount: string;
    status: string;
    invoice?: { invoiceNo: string } | null;
    contract?: { contractNo: string } | null;
    customer?: { name: string } | null;
  } | null;
};

type Candidate = {
  payment: {
    id: string;
    paymentNo: string;
    amount: string;
    status: string;
    receivedAt: string;
    invoice?: { invoiceNo: string } | null;
    contract?: { contractNo: string } | null;
    customer?: { name: string } | null;
  };
  score: number;
  reasons: string[];
};

type SummaryData = {
  unmatchedCount: number;
  suggestedCount: number;
  autoMatchedCount: number;
  confirmedCount: number;
  ignoredCount: number;
  discrepancyCount: number;
};

export default function ReconciliationPage() {
  const { isMobile } = useResponsive();
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<BankTransactionRow | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [discrepancyDrawerOpen, setDiscrepancyDrawerOpen] = useState(false);
  const [resolution, setResolution] = useState("");

  const { data: summary, mutate: mutateSummary } = useSWR<SummaryData>(
    "/api/reconciliation/summary"
  );

  const isFinance = session?.user?.roleCode === "FINANCE" || session?.user?.roleCode === "ADMIN";

  const { run: runAction } = useActionCall({
    baseUrl: "/api/reconciliation/transactions",
    reload: () => {
      mutateSummary();
    },
  });

  const handleAutoMatch = async (id: string) => {
    await runAction(`${id}/match`, { action: "auto-match" });
  };

  const handleConfirmMatch = async (txId: string, paymentId: string) => {
    await runAction(`${txId}/match`, { action: "confirm-match", paymentId });
    setDrawerOpen(false);
  };

  const handleUnmatch = async (id: string) => {
    await runAction(`${id}/match`, { action: "unmatch" });
  };

  const handleIgnore = async (id: string) => {
    await runAction(`${id}/match`, { action: "ignore" });
  };

  const handleBatchMatch = async () => {
    const res = await fetch("/api/reconciliation/transactions/batch-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    const j = await res.json();
    if (j.code === 0) {
      message.success(`批量匹配完成: 自动匹配 ${j.data.matched} 条, 建议 ${j.data.suggested} 条`);
      mutateSummary();
    } else {
      message.error(j.message);
    }
  };

  const handleImport = async () => {
    try {
      const rows = JSON.parse(importText);
      if (!Array.isArray(rows)) throw new Error("请输入 JSON 数组格式");
      const res = await fetch("/api/reconciliation/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const j = await res.json();
      if (j.code === 0) {
        message.success(`导入完成: 成功 ${j.data.success} 条, 失败 ${j.data.failed} 条`);
        setImportModalOpen(false);
        setImportText("");
        mutateSummary();
      } else {
        message.error(j.message);
      }
    } catch (e) {
      message.error("JSON 解析失败: " + (e as Error).message);
    }
  };

  const openTxDetail = async (tx: BankTransactionRow) => {
    setSelectedTx(tx);
    setDrawerOpen(true);
    if (tx.matchStatus === "UNMATCHED") {
      // 实时加载候选
      try {
        const res = await fetch(`/api/reconciliation/transactions/${tx.id}`, {
          credentials: "include",
        });
        const j = await res.json();
        if (j.code === 0) {
          setCandidates(j.data.candidates ?? []);
        }
      } catch {
        setCandidates([]);
      }
    } else {
      setCandidates([]);
    }
  };

  const openDiscrepancyDrawer = () => {
    setDiscrepancyDrawerOpen(true);
  };

  const handleResolveDiscrepancy = async (id: string) => {
    const res = await fetch(`/api/reconciliation/discrepancies/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ resolution }),
    });
    const j = await res.json();
    if (j.code === 0) {
      message.success("已标记处理");
      setResolution("");
      mutateSummary();
    } else {
      message.error(j.message);
    }
  };

  const columns = [
    {
      title: "交易日期",
      dataIndex: "transactionDate",
      width: 120,
      render: (_: unknown, r: BankTransactionRow) => <DateTimeCell value={r.transactionDate} />,
    },
    {
      title: "流水号",
      dataIndex: "bankRefNo",
      width: 180,
      render: (_: unknown, r: BankTransactionRow) => (
        <Link href={`/payments/reconciliation?txId=${r.id}`} onClick={(e) => { e.preventDefault(); openTxDetail(r); }}>
          {r.bankRefNo}
        </Link>
      ),
    },
    {
      title: "金额",
      dataIndex: "amount",
      width: 120,
      render: (_: unknown, r: BankTransactionRow) => <CurrencyCell value={r.amount} />,
    },
    {
      title: "对方户名",
      dataIndex: "counterpartyName",
      width: 160,
      ellipsis: true,
    },
    {
      title: "摘要",
      dataIndex: "summary",
      width: 180,
      ellipsis: true,
    },
    {
      title: "匹配状态",
      dataIndex: "matchStatus",
      width: 110,
      render: (_: unknown, r: BankTransactionRow) => {
        const meta = MATCH_STATUS_MAP[r.matchStatus] ?? { label: r.matchStatus, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "匹配分数",
      dataIndex: "matchScore",
      width: 90,
      render: (_: unknown, r: BankTransactionRow) =>
        r.matchScore != null ? <Tag color={r.matchScore >= 80 ? "green" : r.matchScore >= 60 ? "blue" : "default"}>{r.matchScore}分</Tag> : "—",
    },
    {
      title: "关联回款",
      dataIndex: ["payment", "paymentNo"],
      width: 140,
      render: (_: unknown, r: BankTransactionRow) =>
        r.payment ? (
          <Link href={`/payments/${r.payment.id}`}>{r.payment.paymentNo}</Link>
        ) : (
          <span style={{ color: "var(--qt-text-disabled)" }}>—</span>
        ),
    },
    {
      title: "操作",
      width: 180,
      fixed: isMobile ? undefined : ("right" as const),
      render: (_: unknown, r: BankTransactionRow) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openTxDetail(r)}>
            详情
          </Button>
          {r.matchStatus === "UNMATCHED" && isFinance && (
            <Button size="small" type="primary" icon={<SyncOutlined />} onClick={() => handleAutoMatch(r.id)}>
              匹配
            </Button>
          )}
          {(r.matchStatus === "AUTO_MATCHED" || r.matchStatus === "CONFIRMED_MATCHED" || r.matchStatus === "MANUAL_MATCHED") && isFinance && (
            <Button size="small" icon={<CloseOutlined />} onClick={() => handleUnmatch(r.id)}>
              取消
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="对账中心"
        subtitle="银行流水导入、自动匹配、差异处理与对账确认"
        actions={
          <Space wrap>
            <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
              导入流水
            </Button>
            <Button type="primary" icon={<SyncOutlined />} onClick={handleBatchMatch} disabled={!isFinance}>
              批量自动匹配
            </Button>
            <Button onClick={openDiscrepancyDrawer}>
              差异处理 ({summary?.discrepancyCount ?? 0})
            </Button>
          </Space>
        }
      />

      <StatGrid
        columns={isMobile ? 2 : 6}
        items={[
          { label: "待匹配", value: summary?.unmatchedCount ?? 0 },
          { label: "建议匹配", value: summary?.suggestedCount ?? 0 },
          { label: "自动匹配待确认", value: summary?.autoMatchedCount ?? 0 },
          { label: "已确认匹配", value: summary?.confirmedCount ?? 0 },
          { label: "已忽略", value: summary?.ignoredCount ?? 0 },
          { label: "待处理差异", value: summary?.discrepancyCount ?? 0 },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        <ProTable<BankTransactionRow>
          rowKey="id"
          search={{
            labelWidth: "auto",
            defaultCollapsed: isMobile,
            layout: isMobile ? "vertical" : undefined,
          }}
          scroll={{ x: "max-content" }}
          pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
          cardBordered={false}
          sticky={isMobile}
          request={async (params) => {
            const qs = new URLSearchParams();
            qs.set("page", String(params.current ?? 1));
            qs.set("pageSize", String(params.pageSize ?? 20));
            if (params.keyword) qs.set("keyword", String(params.keyword));
            if (params.matchStatus) qs.set("matchStatus", String(params.matchStatus));
            if (params.startDate) qs.set("startDate", String(params.startDate));
            if (params.endDate) qs.set("endDate", String(params.endDate));
            const res = await fetch(`/api/reconciliation/transactions?${qs}`, { credentials: "include" });
            const j = await res.json();
            return {
              data: j.data?.list ?? [],
              total: j.data?.total ?? 0,
              success: true,
            };
          }}
          columns={[
            {
              title: "关键词",
              dataIndex: "keyword",
              hideInTable: true,
              fieldProps: { placeholder: "流水号 / 对方户名 / 摘要" },
            },
            {
              title: "匹配状态",
              dataIndex: "matchStatus",
              hideInTable: true,
              valueEnum: {
                UNMATCHED: { text: "待匹配" },
                AUTO_MATCHED: { text: "自动匹配" },
                CONFIRMED_MATCHED: { text: "已确认" },
                MANUAL_MATCHED: { text: "手动匹配" },
                IGNORED: { text: "已忽略" },
              },
            },
            ...columns,
          ]}
          options={{
            density: !isMobile,
            fullScreen: !isMobile,
          }}
        />
      </div>

      {/* 流水详情 Drawer */}
      <Drawer
        title={`流水详情 · ${selectedTx?.bankRefNo ?? ""}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? "100%" : 720}
      >
        {selectedTx && (
          <div>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="交易日期">{formatDateTime(selectedTx.transactionDate)}</Descriptions.Item>
              <Descriptions.Item label="金额">{formatCurrency(selectedTx.amount)}</Descriptions.Item>
              <Descriptions.Item label="流水号">{selectedTx.bankRefNo}</Descriptions.Item>
              <Descriptions.Item label="对方户名">{selectedTx.counterpartyName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="摘要" span={2}>{selectedTx.summary ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="匹配状态" span={2}>
                <Tag color={MATCH_STATUS_MAP[selectedTx.matchStatus]?.color}>
                  {MATCH_STATUS_MAP[selectedTx.matchStatus]?.label ?? selectedTx.matchStatus}
                </Tag>
                {selectedTx.matchScore != null && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>{selectedTx.matchScore}分</Tag>
                )}
              </Descriptions.Item>
              {selectedTx.matchReason && (
                <Descriptions.Item label="匹配依据" span={2}>{selectedTx.matchReason}</Descriptions.Item>
              )}
            </Descriptions>

            {selectedTx.payment && (
              <div style={{ marginTop: 16 }}>
                <h4>已匹配回款</h4>
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="回款单号">
                    <Link href={`/payments/${selectedTx.payment.id}`}>{selectedTx.payment.paymentNo}</Link>
                  </Descriptions.Item>
                  <Descriptions.Item label="金额">{formatCurrency(selectedTx.payment.amount)}</Descriptions.Item>
                  <Descriptions.Item label="发票号">{selectedTx.payment.invoice?.invoiceNo ?? "—"}</Descriptions.Item>
                  <Descriptions.Item label="合同号">{selectedTx.payment.contract?.contractNo ?? "—"}</Descriptions.Item>
                  <Descriptions.Item label="客户">{selectedTx.payment.customer?.name ?? "—"}</Descriptions.Item>
                </Descriptions>
              </div>
            )}

            {candidates.length > 0 && selectedTx.matchStatus === "UNMATCHED" && (
              <div style={{ marginTop: 16 }}>
                <h4>候选匹配（按分数排序）</h4>
                <List
                  dataSource={candidates}
                  renderItem={(c) => (
                    <List.Item
                      actions={[
                        <Button
                          key="confirm"
                          type="primary"
                          size="small"
                          onClick={() => handleConfirmMatch(selectedTx.id, c.payment.id)}
                          disabled={!isFinance}
                        >
                          确认匹配
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <span>{c.payment.paymentNo}</span>
                            <Tag color={c.score >= 80 ? "green" : "blue"}>{c.score}分</Tag>
                          </Space>
                        }
                        description={
                          <div>
                            <div>金额: {formatCurrency(c.payment.amount)} | 客户: {c.payment.customer?.name ?? "—"}</div>
                            <div style={{ fontSize: 12, color: "#999" }}>{c.reasons.join(" · ")}</div>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <Space>
                {selectedTx.matchStatus === "UNMATCHED" && isFinance && (
                  <>
                    <Button type="primary" onClick={() => handleAutoMatch(selectedTx.id)}>
                      自动匹配
                    </Button>
                    <Button onClick={() => handleIgnore(selectedTx.id)}>
                      忽略（非回款）
                    </Button>
                  </>
                )}
                {(selectedTx.matchStatus === "AUTO_MATCHED" || selectedTx.matchStatus === "MANUAL_MATCHED") && isFinance && (
                  <Button danger onClick={() => handleUnmatch(selectedTx.id)}>
                    取消匹配
                  </Button>
                )}
              </Space>
            </div>
          </div>
        )}
      </Drawer>

      {/* 导入 Modal */}
      <Modal
        title="导入银行流水"
        open={importModalOpen}
        onOk={handleImport}
        onCancel={() => setImportModalOpen(false)}
        width={isMobile ? "100%" : 640}
        okText="导入"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <p>请粘贴 JSON 数组格式的银行流水数据。每行应包含以下字段：</p>
          <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 4, fontSize: 12 }}>
{`[
  {
    "流水号": "20260820001",
    "交易日期": "2026-08-20",
    "金额": "50000.00",
    "对方户名": "杭州某某科技有限公司",
    "摘要": "合同款"
  }
]`}
          </pre>
        </div>
        <Input.TextArea
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='[{"流水号":"...","交易日期":"...","金额":"...",...}]'
        />
      </Modal>

      {/* 差异处理 Drawer */}
      <Drawer
        title="对账差异处理"
        open={discrepancyDrawerOpen}
        onClose={() => setDiscrepancyDrawerOpen(false)}
        width={isMobile ? "100%" : 640}
      >
        <DiscrepancyList onResolve={handleResolveDiscrepancy} resolution={resolution} setResolution={setResolution} />
      </Drawer>
    </Page>
  );
}

// 差异列表子组件
function DiscrepancyList({
  onResolve,
  resolution,
  setResolution,
}: {
  onResolve: (id: string) => void;
  resolution: string;
  setResolution: (v: string) => void;
}) {
  const { data, loading } = useListRequest<{
    id: string;
    type: string;
    severity: string;
    description: string;
    status: string;
    expectedAmount?: string;
    actualAmount?: string;
    difference?: string;
    createdAt: string;
  }>("/api/reconciliation/discrepancies", { pageSize: 50 });

  return (
    <div>
      <List
        loading={loading}
        dataSource={data}
        renderItem={(item) => (
          <List.Item
            actions={
              item.status === "OPEN"
                ? [
                    <Button key="resolve" type="primary" size="small" onClick={() => onResolve(item.id)}>
                      标记处理
                    </Button>,
                  ]
                : []
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  <Tag color={SEVERITY_MAP[item.severity]?.color}>{SEVERITY_MAP[item.severity]?.label}</Tag>
                  <span>{DISCREPANCY_TYPE_MAP[item.type] ?? item.type}</span>
                </Space>
              }
              description={
                <div>
                  <div>{item.description}</div>
                  {item.expectedAmount && item.actualAmount && (
                    <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                      期望: {formatCurrency(item.expectedAmount)} | 实际: {formatCurrency(item.actualAmount)} | 差额: {formatCurrency(item.difference ?? 0)}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "#999" }}>{formatDateTime(item.createdAt)}</div>
                </div>
              }
            />
          </List.Item>
        )}
      />
      {data.some((d) => d.status === "OPEN") && (
        <div style={{ marginTop: 16 }}>
          <Input.TextArea
            rows={2}
            placeholder="处理结果说明..."
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
