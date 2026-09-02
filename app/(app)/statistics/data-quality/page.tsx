"use client";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Segmented, Tag, Typography } from "antd";
import {
  ExclamationCircleOutlined,
  ReloadOutlined,
  FileProtectOutlined,
  AuditOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type IssueStatus = "OPEN" | "RESOLVED";

type Item = {
  id: string;
  issueCode: string;
  status: IssueStatus;
  detail: string | null;
  createdAt: string;
  resolvedAt: string | null;
  invoiceId: string;
  invoiceNo: string;
  customerName: string;
  contractNo: string | null;
  ownerName: string | null;
  amount: number;
  actualIssueDate: string | null;
  dueDate: string | null;
};

type Summary = {
  openIssueCount: number;
  resolvedIssueCount: number;
  openInvoiceCount: number;
  openAmount: number;
};

const ISSUE_META: Record<string, { label: string; color: string }> = {
  PENDING_INVOICE_NO: { label: "占位发票号", color: "volcano" },
  NO_INVOICE_REQUIRED: { label: "内部无票收据", color: "purple" },
  INVALID_AGING_DATE: { label: "异常账龄日期", color: "orange" },
  DUPLICATE_INVOICE_NO: { label: "历史重复发票号", color: "gold" }
};

const ISSUE_OPTIONS = Object.entries(ISSUE_META).map(([value, meta]) => ({
  value,
  label: meta.label
}));

async function fetchSummary(): Promise<Summary> {
  const r = await fetch("/api/statistics/invoice-data-quality?pageSize=1", {
    credentials: "include"
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data.summary as Summary;
}

export default function DataQualityPage() {
  const { isMobile } = useResponsive();
  const [status, setStatus] = useState<IssueStatus>("OPEN");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await fetchSummary());
    } catch (e) {
      setSummaryError((e as Error).message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const request = useCallback(
    async (params: {
      current?: number;
      pageSize?: number;
      issueCode?: string;
      keyword?: string;
    }) => {
      const qs = new URLSearchParams();
      qs.set("page", String(params.current ?? 1));
      qs.set("pageSize", String(params.pageSize ?? 20));
      qs.set("status", status);
      if (params.issueCode) qs.set("issueCode", params.issueCode);
      if (params.keyword) qs.set("keyword", params.keyword);
      const r = await fetch(`/api/statistics/invoice-data-quality?${qs}`, {
        credentials: "include"
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      return {
        data: (j.data?.list ?? []) as Item[],
        total: j.data?.total ?? 0,
        success: true
      };
    },
    [status]
  );

  const kpis: StatItem[] = [
    {
      label: "待处理记录",
      icon: <ExclamationCircleOutlined />,
      value: summary?.openIssueCount ?? 0,
      suffix: "条",
      description: "仍处于隔离/复核状态"
    },
    {
      label: "涉及发票",
      icon: <AuditOutlined />,
      value: summary?.openInvoiceCount ?? 0,
      suffix: "张",
      description: "按发票去重统计"
    },
    {
      label: "问题发票金额",
      icon: <FileProtectOutlined />,
      value: formatCurrency(summary?.openAmount ?? 0),
      description: "存在待处理问题的发票票面金额"
    },
    {
      label: "已处理记录",
      icon: <ReloadOutlined />,
      value: summary?.resolvedIssueCount ?? 0,
      suffix: "条",
      description: "已完成回填/收口"
    }
  ];

  const columns: ProColumns<Item>[] = [
    {
      title: "关键词",
      dataIndex: "keyword",
      hideInTable: true,
      fieldProps: { placeholder: "收据号 / 客户 / 合同" }
    },
    {
      title: "问题类型",
      dataIndex: "issueCode",
      valueEnum: Object.fromEntries(ISSUE_OPTIONS.map((o) => [o.value, { text: o.label }])),
      width: 150,
      fixed: !isMobile ? "left" : undefined,
      render: (_, r) => {
        const meta = ISSUE_META[r.issueCode] ?? { label: r.issueCode, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      }
    },
    {
      title: "状态",
      dataIndex: "status",
      search: false,
      width: 90,
      render: (_, r) => (
        <Tag color={r.status === "OPEN" ? "red" : "green"}>
          {r.status === "OPEN" ? "待处理" : "已处理"}
        </Tag>
      )
    },
    {
      title: "收据号 / 发票号",
      dataIndex: "invoiceNo",
      search: false,
      width: 220,
      fixed: !isMobile ? "left" : undefined,
      render: (_, r) => (
        <Link href={`/invoices/${r.invoiceId}`} style={{ wordBreak: "break-all" }}>
          {r.invoiceNo}
        </Link>
      )
    },
    { title: "客户", dataIndex: "customerName", search: false, width: 200 },
    { title: "合同号", dataIndex: "contractNo", search: false, width: 160 },
    {
      title: "金额",
      dataIndex: "amount",
      search: false,
      width: 130,
      align: "right",
      render: (_, r) => formatCurrency(r.amount)
    },
    {
      title: "开票日",
      dataIndex: "actualIssueDate",
      search: false,
      width: 120,
      render: (_, r) => formatDate(r.actualIssueDate)
    },
    {
      title: "到期日",
      dataIndex: "dueDate",
      search: false,
      width: 120,
      render: (_, r) => formatDate(r.dueDate)
    },
    {
      title: "说明",
      dataIndex: "detail",
      search: false,
      ellipsis: true,
      width: 240,
      render: (_, r) => r.detail ?? <Text type="secondary">-</Text>
    },
    {
      title: "处理时间",
      dataIndex: "resolvedAt",
      search: false,
      width: 170,
      render: (_, r) =>
        r.status === "RESOLVED" ? formatDateTime(r.resolvedAt) : <Text type="secondary">-</Text>
    }
  ];

  return (
    <Page>
      <PageHeader
        title="异常数据"
        subtitle="应收账龄与发票数据质量问题台账：占位发票号、内部无票收据、异常日期与历史重复编号"
        actions={
          <Segmented<IssueStatus>
            options={[
              { value: "OPEN", label: "待处理" },
              { value: "RESOLVED", label: "已处理" }
            ]}
            value={status}
            onChange={(v) => setStatus(v)}
          />
        }
      />

      {summaryError ? (
        <EmptyState error={{ message: summaryError, onRetry: loadSummary }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={kpis} columns={4} loading={summaryLoading && !summary} />
          <div style={{ marginTop: 24 }}>
            <ProTable<Item>
              rowKey="id"
              search={{ labelWidth: "auto", defaultCollapsed: false, layout: isMobile ? "vertical" : undefined }}
              scroll={{ x: "max-content" }}
              pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
              cardBordered={false}
              sticky={isMobile}
              params={{ status }}
              request={request}
              columns={columns}
              options={{ density: !isMobile, fullScreen: !isMobile }}
            />
          </div>
        </>
      )}
    </Page>
  );
}
