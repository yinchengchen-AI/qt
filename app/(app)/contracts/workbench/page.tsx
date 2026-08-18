"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Button, Card } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid } from "@/components/stat-grid";
import { StatusTag } from "@/components/status-tag";
import { WorkbenchTodoList } from "@/components/workbench/workbench-todo-list";
import { ExpiryBadge } from "@/components/workbench/expiry-badge";
import { RiskDrawer, RiskTag } from "@/components/workbench/risk-drawer";
import { RenewalModal } from "@/components/workbench/renewal-modal";
import { DateCell, CurrencyCell } from "@/components/table-cells";
import { makeListRequest } from "@/lib/use-list-request";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { useResponsive } from "@/lib/use-breakpoint";
import type { ContractRisk } from "@/server/services/contract/risk-score";

type MyStats = {
  active: number;
  expiringSoon: number;
  overdue: number;
  risk: number;
};

type ContractRow = {
  id: string;
  contractNo: string;
  customerName: string;
  title: string;
  signDate: string;
  endDate: string;
  totalAmount: string;
  invoicedAmount: number;
  paidAmount: number;
  status: string;
};

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data as T;
};

export default function ContractWorkbenchPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("contract");
  const [riskDrawerOpen, setRiskDrawerOpen] = useState(false);
  const [renewSourceId, setRenewSourceId] = useState<string | null>(null);
  const { data: stats, isLoading: statsLoading } = useSWR<MyStats>(
    "/api/contracts/my-stats",
    fetcher
  );
  const { data: todos = [], isLoading: todosLoading, mutate: mutateTodos } = useSWR<import("@/server/services/contract/workbench").TodoItem[]>(
    "/api/contracts/my-todos",
    fetcher
  );
  // 我的风险合同 (MEDIUM+): 给"我的合同"表的风险列提供 contractId → level/score 映射
  const { data: risks = [] } = useSWR<ContractRisk[]>("/api/contracts/my-risk", fetcher);
  const riskByContract = new Map(risks.map((r) => [r.contractId, r]));

  return (
    <Page>
      <PageHeader
        title="合同工作台"
        subtitle="我的合同概览与待办：到期预警、逾期跟进、生效未开票提醒"
        actions={
          <Button type="primary" onClick={() => router.push("/contracts/new")}>
            新建合同
          </Button>
        }
      />
      <StatGrid
        loading={statsLoading}
        items={[
          {
            label: "我的活跃合同",
            value: stats?.active ?? "—",
            icon: <FileTextOutlined />,
            tooltip: "本人负责、状态为生效中的合同数"
          },
          {
            label: "即将到期",
            value: stats?.expiringSoon ?? "—",
            icon: <ClockCircleOutlined />,
            tooltip: "7 天内到期（含今天）的生效合同数"
          },
          {
            label: "逾期合同",
            value: stats?.overdue ?? "—",
            icon: <WarningOutlined />,
            tooltip: "已过到期日仍未完结的生效合同数"
          },
          {
            label: "风险预警",
            value: stats?.risk ?? "—",
            icon: <CheckCircleOutlined />,
            tooltip: "我的活跃合同中风险等级为高/严重的数量（实时计算）",
            description: (
              <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 12 }} onClick={() => setRiskDrawerOpen(true)}>
                查看风险合同 ›
              </Button>
            )
          }
        ]}
      />
      <Card size="small" title="我的待办" style={{ marginTop: isMobile ? 8 : 16 }} styles={{ body: { paddingTop: 4, paddingBottom: 4 } }}>
        <WorkbenchTodoList todos={todos} loading={todosLoading} onRenew={(id) => setRenewSourceId(id)} />
      </Card>
      <ProTable<ContractRow>
        rowKey="id"
        style={{ marginTop: isMobile ? 8 : 16 }}
        search={false}
        options={{ density: !isMobile, fullScreen: !isMobile }}
        scroll={{ x: "max-content" }}
        pagination={{ defaultPageSize: 10, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        cardBordered={false}
        headerTitle="我的合同"
        toolBarRender={() => [
          <Button key="all" size="small" onClick={() => router.push("/contracts")}>
            查看全部合同
          </Button>
        ]}
        request={makeListRequest<ContractRow>("/api/contracts", () => ({ mine: "true" }))}
        columns={[
          {
            title: "合同号",
            dataIndex: "contractNo",
            width: 180,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => <Link href={`/contracts/${r.id}`}>{r.contractNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", width: 180, ellipsis: true },
          { title: "合同标题", dataIndex: "title", width: 240, ellipsis: true },
          {
            title: "签订日",
            dataIndex: "signDate",
            valueType: "date",
            width: 120,
            render: (_, r) => <DateCell value={r.signDate} />
          },
          {
            title: "到期",
            dataIndex: "endDate",
            valueType: "date",
            width: 150,
            render: (_, r) => <ExpiryBadge endDate={r.endDate} />
          },
          {
            title: "总额(元)",
            dataIndex: "totalAmount",
            width: 140,
            render: (_, r) => <CurrencyCell value={r.totalAmount} />
          },
          {
            title: "已开票(元)",
            dataIndex: "invoicedAmount",
            width: 140,
            render: (_, r) => <CurrencyCell value={r.invoicedAmount} />
          },
          {
            title: "已回款(元)",
            dataIndex: "paidAmount",
            width: 140,
            render: (_, r) => <CurrencyCell value={r.paidAmount} />
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="contract" />
          },
          {
            title: "风险",
            dataIndex: "risk",
            width: 100,
            render: (_, r) => {
              const risk = riskByContract.get(r.id);
              if (!risk) return <span style={{ color: "rgba(0,0,0,0.25)" }}>—</span>;
              return (
                <Button
                  type="text"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => setRiskDrawerOpen(true)}
                >
                  <RiskTag level={risk.level} score={risk.score} />
                </Button>
              );
            }
          }
        ]}
      />
      <RiskDrawer open={riskDrawerOpen} onClose={() => setRiskDrawerOpen(false)} />
      <RenewalModal
        sourceContractId={renewSourceId}
        onClose={() => setRenewSourceId(null)}
        onSuccess={() => {
          setRenewSourceId(null);
          // 续签创建后源合同待办消失 (服务端按 renewal 记录排除), 刷新待办
          void mutateTodos();
        }}
      />
    </Page>
  );
}
