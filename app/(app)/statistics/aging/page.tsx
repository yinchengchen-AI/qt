"use client";
import {
  ProCard,
  ProForm,
  ProFormDigit,
  ProFormSelect,
  QueryFilter,
  ProTable
} from "@ant-design/pro-components";
import { Button, Segmented, Space, Tabs, Tag, Typography, theme } from "antd";
import { Column, Line } from "@ant-design/charts";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import useSWR from "swr";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { AgingSummary } from "@/components/aging-summary";
import { DunningDrawer, DunningBadge } from "@/components/dunning-drawer";
import { Authority } from "@/components/authority";
import { EmptyState } from "@/components/empty-state";
import { HintBox } from "@/components/callout";
import { StatusTag } from "@/components/status-tag";
import { formatCurrency, formatDate } from "@/lib/format";
import { downloadExcel } from "@/lib/excel-client";
import { useResponsive } from "@/lib/use-breakpoint";
import { useT } from "@/lib/i18n";
// RESOURCE/ACTION 来自 Authority 内部 import

const { Text } = Typography;
const { useToken } = theme;

// ── 类型(与 service 对齐) ──
type AgingBasis = "issue" | "due";
type Bucket = "0-30" | "31-60" | "61-90" | "90+";
const BUCKETS: Bucket[] = ["0-30", "31-60", "61-90", "90+"];
const BUCKET_COLORS: Record<Bucket, string> = {
  "0-30": "#52c41a",
  "31-60": "#1677ff",
  "61-90": "#faad14",
  "90+": "#ff4d4f"
};

type AgingRow = {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  contractId: string;
  contractNo: string | null;
  ownerUserId: string;
  ownerName: string;
  daysOverdue: number;
  remaining: number;
  bucket: Bucket;
  status: string;
  basisUsed: AgingBasis;
  hasDunning: boolean;
};

type AgingDimensionRow = {
  key: string;
  name: string;
  code: string | null;
  totalReceivable: number;
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90: number;
  over90Ratio: number;
  invoiceCount: number;
};

type AgingResult = {
  buckets: Record<Bucket, number>;
  total: number;
  rows: AgingRow[];
  summary: {
    totalReceivable: number;
    over90Amount: number;
    over90Ratio: number;
    largestInvoice: { invoiceId: string; invoiceNo: string; remaining: number } | null;
    customerCount: number;
    ownerCount: number;
  };
  byCustomer: AgingDimensionRow[];
  byOwner: AgingDimensionRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  basisUsed: AgingBasis;
};

type TrendRow = { date: string; total: number; byBucket: Record<Bucket, number> };

// ── 筛选条件 ──
type FilterValues = {
  basis: AgingBasis;
  buckets?: Bucket[];
  customerId?: string;
  ownerUserId?: string;
  contractId?: string;
  minAmount?: number;
};

const DEFAULT_FILTER: FilterValues = { basis: "due" };

// ── 通用 fetcher: { code, data, message } 格式 ──
async function swrFetcher<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data as T;
}

// ── 页面主组件 ──
export default function AgingPage() {
  const t = useT();
  const { isMobile } = useResponsive();

  // 共享筛选 — QueryFilter 一次性托管,所有 tab 共享
  const [filter, setFilter] = useState<FilterValues>(DEFAULT_FILTER);
  const [agingData, setAgingData] = useState<AgingResult | null>(null);
  const [agingLoading, setAgingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("detail");

  // dunning drawer
  const [dunningInvoiceId, setDunningInvoiceId] = useState<string | null>(null);
  const [dunningInvoiceNo, setDunningInvoiceNo] = useState<string | undefined>();

  // 客户/负责人/合同下拉选项(SWR 缓存, 失败回落空)
  const { data: customerOptions = [] } = useSWR<Array<{ value: string; label: string }>>(
    "/api/customers?pageSize=200",
    (url) =>
      swrFetcher<{ list: Array<{ id: string; name: string }> }>(url).then((d) =>
        d.list.map((c) => ({ value: c.id, label: c.name }))
      ),
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
  );
  const { data: ownerOptions = [] } = useSWR<Array<{ value: string; label: string }>>(
    "/api/users?pageSize=200&status=ACTIVE",
    (url) =>
      swrFetcher<{ list: Array<{ id: string; name: string }> }>(url).then((d) =>
        d.list.map((u) => ({ value: u.id, label: u.name }))
      ),
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
  );
  const { data: contractOptions = [] } = useSWR<Array<{ value: string; label: string }>>(
    "/api/contracts?pageSize=200",
    (url) =>
      swrFetcher<{ list: Array<{ id: string; contractNo: string; title: string }> }>(url).then((d) =>
        d.list.map((c) => ({ value: c.id, label: `${c.contractNo} · ${c.title}` }))
      ),
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
  );

  // 趋势数据(只在初次加载拉一次,切换 basis 时重拉)
  const trendUrl = `/api/statistics/aging/trend?days=30&basis=${filter.basis}`;
  const { data: trendData = [] as TrendRow[] } = useSWR<TrendRow[]>(
    trendUrl,
    (url) => swrFetcher<TrendRow[]>(url),
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
  );

  // 拉 aging 主数据 — filter 变化时重拉
  const refetchAging = useCallback(async () => {
    setAgingLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("basis", filter.basis);
      if (filter.buckets && filter.buckets.length > 0 && filter.buckets.length < BUCKETS.length) {
        qs.set("buckets", filter.buckets.join(","));
      }
      if (filter.customerId) qs.set("customerId", filter.customerId);
      if (filter.ownerUserId) qs.set("ownerUserId", filter.ownerUserId);
      if (filter.contractId) qs.set("contractId", filter.contractId);
      if (typeof filter.minAmount === "number" && filter.minAmount > 0) {
        qs.set("minAmount", String(filter.minAmount));
      }
      qs.set("pageSize", "20");
      const data = await swrFetcher<AgingResult>(`/api/statistics/invoice-aging?${qs}`);
      setAgingData(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAgingLoading(false);
    }
  }, [filter]);

  // 首次 + filter 变化时拉
  useMemo(() => {
    refetchAging();
  }, [refetchAging]);

  // dunningMap 派生(不缓存, 避免内存泄漏 + 始终 fresh)
  const dunningMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of agingData?.rows ?? []) {
      if (r.hasDunning) map[r.invoiceId] = 1;
    }
    return map;
  }, [agingData]);

  const handleExport = async () => {
    try {
      const qs = new URLSearchParams();
      qs.set("type", "aging");
      qs.set("basis", filter.basis);
      if (filter.buckets && filter.buckets.length > 0 && filter.buckets.length < BUCKETS.length) {
        qs.set("buckets", filter.buckets.join(","));
      }
      if (filter.customerId) qs.set("customerId", filter.customerId);
      if (filter.ownerUserId) qs.set("ownerUserId", filter.ownerUserId);
      if (filter.contractId) qs.set("contractId", filter.contractId);
      if (typeof filter.minAmount === "number" && filter.minAmount > 0) {
        qs.set("minAmount", String(filter.minAmount));
      }
      await downloadExcel(
        `/api/statistics/export?${qs}`,
        `账龄分析_${filter.basis}_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch {
      // downloadExcel 已经会 message.error, 这里静默
    }
  };

  const handleDunningChanged = useCallback(() => {
    refetchAging();
  }, [refetchAging]);

  // ── 渲染 ──
  return (
    <Page>
      <PageHeader
        title={t("aging.title")}
        subtitle={t("aging.subtitle")}
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={refetchAging}>刷新</Button>
            <Authority code="STATISTICS:EXPORT">
              <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 Excel</Button>
            </Authority>
          </Space>
        }
      />

      {/* 筛选卡片 — 与其它页(ProTable search form)样式一致的 QueryFilter */}
      <ProCard size="small" style={{ marginBottom: 16 }} styles={{ body: { padding: isMobile ? 8 : 16 } }}>
        <QueryFilter
          defaultCollapsed={false}
          split={false}
          labelWidth={isMobile ? 0 : "auto"}
          layout={isMobile ? "vertical" : "horizontal"}
          onFinish={async (values) => {
            setFilter({
              basis: (values.basis as AgingBasis) || "due",
              buckets: Array.isArray(values.buckets) ? (values.buckets as Bucket[]) : undefined,
              customerId: values.customerId as string | undefined,
              ownerUserId: values.ownerUserId as string | undefined,
              contractId: values.contractId as string | undefined,
              minAmount: typeof values.minAmount === "number" ? values.minAmount : undefined
            });
          }}
          onReset={() => setFilter(DEFAULT_FILTER)}
          initialValues={{ basis: "due" }}
        >
          <ProForm.Item name="basis" label="账龄基准">
            <Segmented
              options={[
                { label: "按到期日", value: "due" },
                { label: "按开票日", value: "issue" }
              ]}
              size="middle"
            />
          </ProForm.Item>
          <ProFormSelect
            name="buckets"
            label="账龄段"
            placeholder="全部"
            allowClear
            mode="multiple"
            options={BUCKETS.map((b) => ({ value: b, label: b }))}
          />
          <ProFormSelect
            name="customerId"
            label="客户"
            placeholder="全部客户"
            allowClear
            showSearch
            options={customerOptions}
            fieldProps={{ filterOption: (input, option) => (option?.label ?? "").toString().includes(input) }}
          />
          <ProFormSelect
            name="ownerUserId"
            label="负责人"
            placeholder="全部负责人"
            allowClear
            showSearch
            options={ownerOptions}
            fieldProps={{ filterOption: (input, option) => (option?.label ?? "").toString().includes(input) }}
          />
          <ProFormSelect
            name="contractId"
            label="合同"
            placeholder="全部合同"
            allowClear
            showSearch
            options={contractOptions}
            fieldProps={{ filterOption: (input, option) => (option?.label ?? "").toString().includes(input) }}
          />
          <ProFormDigit name="minAmount" label="最小金额" placeholder="0" min={0} fieldProps={{ style: { width: 120 } }} />
        </QueryFilter>
      </ProCard>

      {error ? (
        <EmptyState error={{ message: error, onRetry: refetchAging }} title="加载失败" />
      ) : (
        <>
          {/* KPI + 4 桶结构 */}
          {agingData ? (
            <AgingSummary
              buckets={agingData.buckets}
              summary={agingData.summary}
              basisUsed={agingData.basisUsed}
              invoiceCount={agingData.total}
              columns={isMobile ? 2 : 5}
            />
          ) : null}

          {/* 趋势 + 4 桶柱图 同行 */}
          <div style={{ marginTop: 24 }}>
            <ProCard split="vertical">
              <ProCard title="账龄分布" colSpan={isMobile ? 24 : 12}>
                {agingData && BUCKETS.some((b) => (agingData.buckets[b] ?? 0) > 0) ? (
                  <Column
                    data={BUCKETS.map((b) => ({
                      bucket: b,
                      amount: agingData.buckets[b] ?? 0,
                      color: BUCKET_COLORS[b]
                    }))}
                    xField="bucket"
                    yField="amount"
                    height={240}
                    colorField="bucket"
                    autoFit
                    scale={{ color: { range: ["#52c41a", "#1677ff", "#faad14", "#ff4d4f"] } }}
                    label={{
                      text: (d: { amount: number }) => formatCurrency(d.amount),
                      style: { fontSize: 11 }
                    }}
                  />
                ) : (
                  <EmptyState empty title="暂无超期发票" description="当前所选口径下没有需要关注的应收" height="default" />
                )}
              </ProCard>
              <ProCard title="近 30 天账龄总额趋势" colSpan={isMobile ? 24 : 12}>
                {trendData.length > 0 ? (
                  <Line
                    data={trendData}
                    xField="date"
                    yField="total"
                    height={240}
                    smooth
                    autoFit
                    point={{ size: 3 }}
                    tooltip={{
                      title: (d: TrendRow) => d.date,
                      items: [
                        { name: "应收总额", field: "total" }
                      ]
                    }}
                  />
                ) : (
                  <EmptyState empty title="暂无趋势数据" height="default" />
                )}
              </ProCard>
            </ProCard>
          </div>

          {/* 4 个 Tab — 全部 ProTable */}
          <div style={{ marginTop: 24 }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: "detail",
                  label: `明细 (${agingData?.total ?? 0})`,
                  children: <DetailTable data={agingData} loading={agingLoading} dunningMap={dunningMap} onOpenDunning={(id, no) => { setDunningInvoiceId(id); setDunningInvoiceNo(no); }} onChanged={handleDunningChanged} />
                },
                {
                  key: "byCustomer",
                  label: "按客户",
                  children: <DimensionTable data={agingData?.byCustomer ?? []} loading={agingLoading} isMobile={isMobile} nameField="客户" />
                },
                {
                  key: "byOwner",
                  label: "按业务人员",
                  children: <DimensionTable data={agingData?.byOwner ?? []} loading={agingLoading} isMobile={isMobile} nameField="负责人" />
                },
                {
                  key: "uninvoiced",
                  label: "未开票合同",
                  children: <UninvoicedTable isMobile={isMobile} />
                }
              ]}
            />
          </div>
        </>
      )}

      <DunningDrawer
        open={!!dunningInvoiceId}
        invoiceId={dunningInvoiceId}
        invoiceNo={dunningInvoiceNo}
        onClose={() => setDunningInvoiceId(null)}
        onChanged={handleDunningChanged}
      />
    </Page>
  );
}

// ──────────────────────────────────────────────────────────────
// 四个子表组件 — 提取出来避免 page.tsx 臃肿
// ──────────────────────────────────────────────────────────────

function DetailTable({
  data,
  loading,
  dunningMap,
  onOpenDunning,
  onChanged
}: {
  data: AgingResult | null;
  loading: boolean;
  dunningMap: Record<string, number>;
  onOpenDunning: (id: string, no: string) => void;
  onChanged: () => void;
}) {
  const { isMobile } = useResponsive();
  const { token } = useToken();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 服务端已分页,这里只切页(URL 加 page/pageSize 后由 useSWR 重拉)
  // 为了让 pageSize/page 改动生效且不丢 filter,这里用本地 state 控制 + 简单 refetch
  // (实际生产:把 page/pageSize 也放 filter 或 URL state)
  return (
    <ProCard>
      {data && data.rows.length > 0 ? (
        <ProTable<AgingRow>
          rowKey="invoiceId"
          dataSource={data.rows}
          search={false}
          options={false}
          loading={loading}
          scroll={{ x: "max-content" }}
          sticky={isMobile}
          pagination={{
            current: page,
            pageSize,
            total: data.pagination.total,
            showSizeChanger: !isMobile,
            size: isMobile ? "small" : "middle",
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
              onChanged();
            }
          }}
          columns={[
            {
              title: "发票号",
              dataIndex: "invoiceNo",
              width: 180,
              fixed: !isMobile ? "left" : undefined,
              render: (_, r) => (
                <Link href={`/invoices/${r.invoiceId}`} style={{ color: token.colorPrimary, textDecoration: "none" }}>
                  {r.invoiceNo}
                </Link>
              )
            },
            { title: "客户", dataIndex: "customerName", width: 160, ellipsis: true },
            { title: "合同", dataIndex: "contractNo", width: 180, ellipsis: true, render: (_, r) => r.contractNo ? <Text style={{ fontSize: 12 }}>{r.contractNo}</Text> : <Text type="secondary">-</Text> },
            { title: "负责人", dataIndex: "ownerName", width: 100 },
            { title: "账龄段", dataIndex: "bucket", width: 90, render: (_, r) => <Tag color={BUCKET_COLORS[r.bucket]}>{r.bucket}</Tag> },
            { title: "逾期天数", dataIndex: "daysOverdue", width: 100, align: "right", render: (_, r) => <Tag color={BUCKET_COLORS[r.bucket]}>{r.daysOverdue} 天</Tag> },
            { title: "剩余未收", dataIndex: "remaining", width: 140, align: "right", render: (_, r) => <Text strong>{formatCurrency(r.remaining)}</Text> },
            { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status} domain="invoice" /> },
            { title: "催收", dataIndex: "hasDunning", width: 90, render: (_, r) => <DunningBadge count={dunningMap[r.invoiceId] ?? 0} /> },
            {
              title: "操作",
              dataIndex: "actions",
              width: 120,
              fixed: !isMobile ? "right" : undefined,
              render: (_, r) => (
                <Authority code="DUNNING:CREATE">
                  <Button size="small" type="link" onClick={() => onOpenDunning(r.invoiceId, r.invoiceNo)}>
                    添加催收
                  </Button>
                </Authority>
              )
            }
          ]}
        />
      ) : (
        <EmptyState empty title="无超期发票" description="当前所选口径下没有需要关注的应收" height="tall" />
      )}
    </ProCard>
  );
}

function DimensionTable({
  data,
  loading,
  isMobile,
  nameField
}: {
  data: AgingDimensionRow[];
  loading: boolean;
  isMobile: boolean;
  nameField: string;
}) {
  return (
    <ProCard>
      {data.length > 0 ? (
        <ProTable<AgingDimensionRow>
          rowKey="key"
          dataSource={data}
          search={false}
          options={false}
          loading={loading}
          pagination={{ pageSize: 20, simple: isMobile }}
          columns={[
            { title: nameField, dataIndex: "name", width: 220, ellipsis: true },
            { title: "发票数", dataIndex: "invoiceCount", width: 90, align: "right" },
            { title: "总应收", dataIndex: "totalReceivable", width: 140, align: "right", render: (_, r) => formatCurrency(r.totalReceivable) },
            { title: "0-30", dataIndex: "bucket0_30", width: 110, align: "right", render: (_, r) => r.bucket0_30 > 0 ? formatCurrency(r.bucket0_30) : "—" },
            { title: "31-60", dataIndex: "bucket31_60", width: 110, align: "right", render: (_, r) => r.bucket31_60 > 0 ? formatCurrency(r.bucket31_60) : "—" },
            { title: "61-90", dataIndex: "bucket61_90", width: 110, align: "right", render: (_, r) => r.bucket61_90 > 0 ? formatCurrency(r.bucket61_90) : "—" },
            { title: "90+", dataIndex: "bucket90", width: 130, align: "right", render: (_, r) => r.bucket90 > 0 ? <Text strong style={{ color: "#ff4d4f" }}>{formatCurrency(r.bucket90)}</Text> : "—" },
            { title: "90+ 占比", dataIndex: "over90Ratio", width: 110, align: "right", render: (_, r) => <Tag color={r.over90Ratio >= 50 ? "red" : r.over90Ratio >= 20 ? "orange" : "default"}>{r.over90Ratio.toFixed(1)}%</Tag> }
          ]}
        />
      ) : (
        <EmptyState empty title="无数据" height="default" />
      )}
    </ProCard>
  );
}

function UninvoicedTable({ isMobile }: { isMobile: boolean }) {
  type Row = {
    contractId: string;
    contractNo: string;
    customerName: string;
    signDate: string;
    totalAmount: number;
    daysSinceSign: number;
    ownerName: string;
    isOverdue: boolean;
  };
  const { data = [] as Row[], isLoading } = useSWR<Row[]>(
    "/api/statistics/aging/uninvoiced-contracts?thresholdDays=30&limit=50",
    (url) => swrFetcher<Row[]>(url),
    { revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
  );
  return (
    <ProCard>
      {isLoading ? (
        <EmptyState loading title="加载中" />
      ) : data.length > 0 ? (
        <>
          <HintBox style={{ marginBottom: 12 }}>
            合同已签订超过 30 天, 尚未开具发票, 共 {data.length} 份
          </HintBox>
          <ProTable<Row>
            rowKey="contractId"
            dataSource={data}
            search={false}
            options={false}
            pagination={{ pageSize: 20, simple: isMobile }}
            columns={[
              { title: "合同号", dataIndex: "contractNo", width: 180 },
              { title: "客户", dataIndex: "customerName", width: 180, ellipsis: true },
              { title: "签订日", dataIndex: "signDate", width: 120, render: (_, r) => formatDate(r.signDate) },
              { title: "合同额", dataIndex: "totalAmount", width: 140, align: "right", render: (_, r) => formatCurrency(r.totalAmount) },
              { title: "已过天数", dataIndex: "daysSinceSign", width: 110, align: "right", render: (_, r) => <Tag color={r.isOverdue ? "red" : "default"}>{r.daysSinceSign} 天</Tag> },
              { title: "负责人", dataIndex: "ownerName", width: 100 }
            ]}
          />
        </>
      ) : (
        <EmptyState empty title="无未开票合同" description="所有生效合同都已开票,继续保持!" height="default" />
      )}
    </ProCard>
  );
}
