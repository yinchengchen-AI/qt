// 催款建议 Tab (账龄分析页): smart-collection 规则引擎 + collection-advice 数据组装
//   每行: 紧急度 / 客户 / 合同 / 未收金额 / 逾期天数 / 建议时机 / 建议方式
//   操作: 查看话术 (Popover, 一键复制) + 记录催收 (打开 DunningDrawer)
"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { App as AntdApp, Button, Popover, Space, Table, Tag, Typography, theme } from "antd";
import { CopyOutlined, MessageOutlined } from "@ant-design/icons";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type Urgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
const URGENCY_META: Record<Urgency, { label: string; color: string }> = {
  CRITICAL: { label: "紧急", color: "#ff4d4f" },
  HIGH: { label: "高", color: "#fa8c16" },
  MEDIUM: { label: "中", color: "#1677ff" },
  LOW: { label: "低", color: "#8c8c8c" }
};

type AdviceItem = {
  contractId: string;
  contractNo: string;
  customerName: string;
  outstandingAmount: number;
  overdueDays: number;
  urgencyLevel: Urgency;
  suggestedTiming: string;
  talkTracks: string[];
  internalNotes: string[];
  suggestedApproach: string;
  invoiceId: string;
  invoiceNo: string;
  ownerName: string | null;
};

type AdviceResult = {
  items: AdviceItem[];
  totalOverdueContracts: number;
  totalOutstanding: number;
  generatedAt: string;
};

async function fetcher(url: string): Promise<AdviceResult> {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data as AdviceResult;
}

export function CollectionAdviceTab({
  onOpenDunning
}: {
  onOpenDunning: (invoiceId: string, invoiceNo: string) => void;
}) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const { isMobile } = useResponsive();
  const { data, error, isLoading, mutate } = useSWR<AdviceResult>(
    "/api/statistics/aging/collection-advice",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  // Popover 受控: 同时只开一个话术面板
  const [openTalkFor, setOpenTalkFor] = useState<string | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败, 请手动选择文本");
    }
  };

  if (error) {
    return <EmptyState error={{ message: error.message, onRetry: () => mutate() }} title="加载催款建议失败" />;
  }

  return (
    <div>
      {data && data.items.length > 0 ? (
        <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
          共 {data.totalOverdueContracts} 份逾期合同, 未收合计 {formatCurrency(data.totalOutstanding)}
          {data.items.length < data.totalOverdueContracts
            ? `, 按紧急度展示前 ${data.items.length} 条`
            : ""}
          ; 建议由规则引擎生成, 供参考
        </Text>
      ) : null}
      <Table<AdviceItem>
        rowKey="contractId"
        dataSource={data?.items ?? []}
        loading={isLoading}
        scroll={{ x: "max-content" }}
        pagination={data && data.items.length > 10 ? { pageSize: 10, size: isMobile ? "small" : "middle" } : false}
        locale={{ emptyText: <EmptyState empty title="暂无逾期合同" description="当前没有需要催收的逾期款项" height="default" /> }}
        columns={[
          {
            title: "紧急度",
            dataIndex: "urgencyLevel",
            width: 90,
            render: (_, r) => {
              const meta = URGENCY_META[r.urgencyLevel];
              return <Tag color={meta.color}>{meta.label}</Tag>;
            }
          },
          { title: "客户", dataIndex: "customerName", width: 160, ellipsis: true },
          {
            title: "合同",
            dataIndex: "contractNo",
            width: 170,
            ellipsis: true,
            render: (_, r) => (
              <Link href={`/contracts/${r.contractId}`} style={{ color: token.colorPrimary, textDecoration: "none" }}>
                {r.contractNo}
              </Link>
            )
          },
          {
            title: "未收金额",
            dataIndex: "outstandingAmount",
            width: 130,
            align: "right",
            render: (_, r) => <Text strong>{formatCurrency(r.outstandingAmount)}</Text>
          },
          {
            title: "逾期天数",
            dataIndex: "overdueDays",
            width: 100,
            align: "right",
            render: (_, r) => <Tag color={r.overdueDays > 30 ? "#ff4d4f" : "#faad14"}>{r.overdueDays} 天</Tag>
          },
          { title: "负责人", dataIndex: "ownerName", width: 90, render: (v: string | null) => v ?? "—" },
          { title: "建议时机", dataIndex: "suggestedTiming", width: 220, ellipsis: true },
          { title: "建议方式", dataIndex: "suggestedApproach", width: 170, ellipsis: true },
          {
            title: "操作",
            key: "actions",
            width: 170,
            fixed: isMobile ? undefined : "right",
            render: (_, r) => (
              <Space size={4}>
                <Popover
                  open={openTalkFor === r.contractId}
                  onOpenChange={(open) => setOpenTalkFor(open ? r.contractId : null)}
                  trigger="click"
                  placement="leftTop"
                  styles={{ content: { maxWidth: 380 } }}
                  content={
                    <div>
                      <Text strong style={{ fontSize: 13 }}>催款话术</Text>
                      <ol style={{ paddingLeft: 18, margin: "8px 0" }}>
                        {r.talkTracks.map((t, i) => (
                          <li key={i} style={{ fontSize: 12, marginBottom: 6 }}>
                            {t}{" "}
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              aria-label={`复制话术 ${i + 1}`}
                              onClick={() => copy(t)}
                            />
                          </li>
                        ))}
                      </ol>
                      {r.internalNotes.length > 0 ? (
                        <>
                          <Text type="secondary" style={{ fontSize: 12 }}>内部备注</Text>
                          <ul style={{ paddingLeft: 18, margin: "4px 0 0" }}>
                            {r.internalNotes.map((n, i) => (
                              <li key={i} style={{ fontSize: 12, color: token.colorTextSecondary }}>{n}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  }
                >
                  <Button size="small" icon={<MessageOutlined />}>话术</Button>
                </Popover>
                <Button size="small" type="primary" ghost onClick={() => onOpenDunning(r.invoiceId, r.invoiceNo)}>
                  记录催收
                </Button>
              </Space>
            )
          }
        ]}
      />
    </div>
  );
}
