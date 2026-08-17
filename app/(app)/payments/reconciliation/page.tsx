"use client";
import { useRef, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid } from "@/components/stat-grid";
import { ProTable } from "@ant-design/pro-components";
import type { ActionType } from "@ant-design/pro-components";
import { Button, App as AntdApp, Drawer, Space, Tag, Descriptions, List, Modal, Input, Upload } from "antd";
import { UploadOutlined, SyncOutlined, CloseOutlined, EyeOutlined, InboxOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { useResponsive } from "@/lib/use-breakpoint";
import { useActionCall } from "@/lib/use-action-call";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useListRequest } from "@/lib/use-list-request";
import { parseDelimitedText } from "@/lib/statement-text";

// 对账状态映射
// SUGGESTED 是虚拟状态: 数据上仍是 UNMATCHED, 只是引擎给出了 ≥60 分建议
const MATCH_STATUS_MAP: Record<string, { label: string; color: string }> = {
  UNMATCHED: { label: "待匹配", color: "default" },
  SUGGESTED: { label: "建议匹配", color: "geekblue" },
  AUTO_MATCHED: { label: "自动匹配", color: "processing" },
  CONFIRMED_MATCHED: { label: "已确认", color: "success" },
  MANUAL_MATCHED: { label: "手动匹配", color: "success" },
  IGNORED: { label: "已忽略", color: "warning" },
};

function effectiveStatus(row: { matchStatus: string; matchScore?: number | string | null }): string {
  if (row.matchStatus === "UNMATCHED" && Number(row.matchScore) >= 60) return "SUGGESTED";
  return row.matchStatus;
}

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
  const actionRef = useRef<ActionType>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<BankTransactionRow | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFileList, setImportFileList] = useState<UploadFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [discrepancyDrawerOpen, setDiscrepancyDrawerOpen] = useState(false);

  const { data: summary, mutate: mutateSummary } = useSWR<SummaryData>(
    "/api/reconciliation/summary"
  );

  const isFinance = session?.user?.roleCode === "FINANCE" || session?.user?.roleCode === "ADMIN";

  // 所有写操作后统一刷新: 统计卡 + 流水表格
  const reloadAll = () => {
    void mutateSummary();
    actionRef.current?.reload();
  };

  const { run: runAction } = useActionCall({
    baseUrl: "/api/reconciliation/transactions",
    reload: reloadAll,
  });

  const refreshSelectedTx = async (id: string) => {
    try {
      const res = await fetch(`/api/reconciliation/transactions/${id}`, { credentials: "include" });
      const j = await res.json();
      if (j.code === 0) {
        setSelectedTx(j.data);
        setCandidates(j.data.candidates ?? []);
      }
    } catch {
      // 刷新失败不打断操作, 表格已 reload
    }
  };

  const handleAutoMatch = async (id: string) => {
    const okFlag = await runAction(`${id}/match`, { action: "auto-match" });
    if (okFlag && selectedTx?.id === id) await refreshSelectedTx(id);
  };

  const handleConfirmMatch = async (txId: string, paymentId: string) => {
    const okFlag = await runAction(`${txId}/match`, { action: "confirm-match", paymentId });
    if (okFlag) setDrawerOpen(false);
  };

  const handleUnmatch = async (id: string) => {
    const okFlag = await runAction(`${id}/match`, { action: "unmatch" });
    if (okFlag && selectedTx?.id === id) await refreshSelectedTx(id);
  };

  const handleIgnore = async (id: string) => {
    const okFlag = await runAction(`${id}/match`, { action: "ignore" });
    if (okFlag && selectedTx?.id === id) await refreshSelectedTx(id);
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
      reloadAll();
    } else {
      message.error(j.message);
    }
  };

  /** 粘贴区内容 → 行记录: JSON 数组, 或从 Excel 直接复制的表格文本 (TSV/CSV, 首行表头) */
  const parseImportText = (text: string): Array<Record<string, unknown>> => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("请粘贴流水数据, 或选择文件上传");
    if (trimmed.startsWith("[")) {
      const rows = JSON.parse(trimmed);
      if (!Array.isArray(rows)) throw new Error("请输入 JSON 数组格式");
      return rows;
    }
    const rows = parseDelimitedText(trimmed);
    if (rows.length === 0) throw new Error("未解析到数据行（首行须为表头, 如: 流水号 交易日期 金额）");
    return rows;
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      let res: Response;
      if (importFileList.length > 0 && importFileList[0]!.originFileObj) {
        // 文件导入: 服务端解析 .xlsx / .csv
        const form = new FormData();
        form.append("file", importFileList[0]!.originFileObj);
        res = await fetch("/api/reconciliation/import", {
          method: "POST",
          credentials: "include",
          body: form,
        });
      } else {
        const rows = parseImportText(importText);
        res = await fetch("/api/reconciliation/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ rows }),
        });
      }
      const j = await res.json();
      if (j.code === 0) {
        message.success(`导入完成: 成功 ${j.data.success} 条, 失败 ${j.data.failed} 条`);
        if (j.data.errors?.length) {
          Modal.warning({
            title: "部分行导入失败",
            content: (
              <div style={{ maxHeight: 300, overflow: "auto" }}>
                {j.data.errors.slice(0, 20).map((e: { row: number; message: string }, i: number) => (
                  <div key={i}>第 {e.row} 行: {e.message}</div>
                ))}
              </div>
            ),
          });
        }
        setImportModalOpen(false);
        setImportText("");
        setImportFileList([]);
        reloadAll();
      } else {
        message.error(j.message);
      }
    } catch (e) {
      message.error("导入失败: " + (e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const openTxDetail = async (tx: BankTransactionRow) => {
    setSelectedTx(tx);
    setDrawerOpen(true);
    if (tx.matchStatus === "UNMATCHED") {
      await refreshSelectedTx(tx.id);
    } else {
      setCandidates([]);
    }
  };

  const columns = [
    {
      title: "交易日期",
      dataIndex: "transactionDate",
      width: 120,
      search: false,
      render: (_: unknown, r: BankTransactionRow) => <DateTimeCell value={r.transactionDate} />,
    },
    {
      title: "流水号",
      dataIndex: "bankRefNo",
      width: 180,
      search: false,
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
      search: false,
      render: (_: unknown, r: BankTransactionRow) => <CurrencyCell value={r.amount} />,
    },
    {
      title: "对方户名",
      dataIndex: "counterpartyName",
      width: 160,
      ellipsis: true,
      search: false,
    },
    {
      title: "摘要",
      dataIndex: "summary",
      width: 180,
      ellipsis: true,
      search: false,
    },
    {
      title: "匹配状态",
      dataIndex: "matchStatus",
      width: 110,
      search: false,
      render: (_: unknown, r: BankTransactionRow) => {
        const key = effectiveStatus(r);
        const meta = MATCH_STATUS_MAP[key] ?? { label: r.matchStatus, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "匹配分数",
      dataIndex: "matchScore",
      width: 90,
      search: false,
      render: (_: unknown, r: BankTransactionRow) =>
        r.matchScore != null ? <Tag color={Number(r.matchScore) >= 80 ? "green" : Number(r.matchScore) >= 60 ? "blue" : "default"}>{r.matchScore}分</Tag> : "—",
    },
    {
      title: "关联回款",
      dataIndex: ["payment", "paymentNo"],
      width: 140,
      search: false,
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
      search: false,
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
            <Button onClick={() => setDiscrepancyDrawerOpen(true)}>
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
          actionRef={actionRef}
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
            try {
              const res = await fetch(`/api/reconciliation/transactions?${qs}`, { credentials: "include" });
              const j = await res.json();
              if (j.code !== 0) {
                message.error(j.message ?? "流水列表加载失败");
                return { data: [], total: 0, success: false };
              }
              return {
                data: j.data?.list ?? [],
                total: j.data?.total ?? 0,
                success: true,
              };
            } catch (e) {
              message.error("流水列表加载失败: " + (e as Error).message);
              return { data: [], total: 0, success: false };
            }
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
                SUGGESTED: { text: "建议匹配" },
                AUTO_MATCHED: { text: "自动匹配" },
                CONFIRMED_MATCHED: { text: "已确认" },
                MANUAL_MATCHED: { text: "手动匹配" },
                IGNORED: { text: "已忽略" },
              },
            },
            {
              title: "交易日期",
              dataIndex: "dateRange",
              hideInTable: true,
              valueType: "dateRange",
              search: {
                transform: (value: [string, string]) => ({ startDate: value[0], endDate: value[1] }),
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
                <Tag color={MATCH_STATUS_MAP[effectiveStatus(selectedTx)]?.color}>
                  {MATCH_STATUS_MAP[effectiveStatus(selectedTx)]?.label ?? selectedTx.matchStatus}
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
        onCancel={() => { setImportModalOpen(false); setImportFileList([]); }}
        width={isMobile ? "100%" : 640}
        okText="导入"
        cancelText="取消"
        confirmLoading={importing}
      >
        <Upload.Dragger
          accept=".xlsx,.csv"
          maxCount={1}
          fileList={importFileList}
          beforeUpload={() => false}
          onChange={({ fileList }) => setImportFileList(fileList.slice(-1))}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽上传银行导出的流水文件</p>
          <p className="ant-upload-hint">支持 .xlsx / .csv，第一行为表头（流水号、交易日期、金额、对方户名、摘要…），单次最多 5000 行</p>
        </Upload.Dragger>
        <div style={{ margin: "12px 0 8px", color: "#999", fontSize: 12 }}>
          也可以直接从 Excel 复制表格粘贴到下面（含表头）, 或粘贴 JSON 数组；上传文件时本框内容会被忽略
        </div>
        <Input.TextArea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={"流水号\t交易日期\t金额\t对方户名\t摘要\n20260820001\t2026-08-20\t50000.00\t杭州某某科技有限公司\t合同款"}
        />
      </Modal>

      {/* 差异处理 Drawer */}
      <Drawer
        title="对账差异处理"
        open={discrepancyDrawerOpen}
        onClose={() => setDiscrepancyDrawerOpen(false)}
        width={isMobile ? "100%" : 640}
      >
        <DiscrepancyList onResolved={reloadAll} />
      </Drawer>
    </Page>
  );
}

// 差异列表子组件
function DiscrepancyList({ onResolved }: { onResolved: () => void }) {
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [resolving, setResolving] = useState(false);

  const isFinance = session?.user?.roleCode === "FINANCE" || session?.user?.roleCode === "ADMIN";

  const { data, loading, error, reload } = useListRequest<{
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

  const handleResolve = async () => {
    if (!resolveTarget) return;
    if (!resolution.trim()) {
      message.warning("请填写处理结果说明");
      return;
    }
    setResolving(true);
    try {
      const res = await fetch(`/api/reconciliation/discrepancies/${resolveTarget}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resolution: resolution.trim() }),
      });
      const j = await res.json();
      if (j.code === 0) {
        message.success("已标记处理");
        setResolveTarget(null);
        setResolution("");
        reload();
        onResolved();
      } else {
        message.error(j.message);
      }
    } finally {
      setResolving(false);
    }
  };

  if (error) {
    return <div style={{ color: "var(--qt-text-danger, #ff4d4f)" }}>差异列表加载失败: {error}</div>;
  }

  return (
    <div>
      <List
        loading={loading}
        dataSource={data}
        renderItem={(item) => (
          <List.Item
            actions={
              item.status === "OPEN" && isFinance
                ? [
                    <Button key="resolve" type="primary" size="small" onClick={() => { setResolveTarget(item.id); setResolution(""); }}>
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
                  {item.status !== "OPEN" && <Tag color="success">已处理</Tag>}
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
      <Modal
        title="标记差异已处理"
        open={resolveTarget != null}
        onOk={handleResolve}
        onCancel={() => setResolveTarget(null)}
        okText="确认"
        cancelText="取消"
        confirmLoading={resolving}
      >
        <Input.TextArea
          rows={3}
          placeholder="处理结果说明（必填）..."
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </Modal>
    </div>
  );
}
