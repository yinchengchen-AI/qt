"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Card, Col, Empty, Row, Space, Statistic, Tabs } from "antd";
import { PlusOutlined, FilePdfOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useDict } from "@/lib/dict-client";
import { useUserName } from "@/lib/user-lookup";
import { CurrencyCell, DateCell, DateTimeCell } from "@/components/table-cells";
import { FollowUpDrawer } from "@/components/file/follow-up-drawer";
import { openPrintWindow } from "@/lib/print-client";
import { useResponsive } from "@/lib/use-breakpoint";

type Customer = {
  id: string; code: string; name: string; shortName: string | null;
  unifiedSocialCreditCode: string | null; customerType: string; industry: string | null; sourceChannel: string | null;
  scale: string | null; status: string;
  contactName: string | null; contactTitle: string | null; contactPhone: string;
  province: string; city: string; address: string | null;
  createdAt: string;
};

type FollowUp = {
  id: string;
  followAt: string;
  method: string;
  content: string;
  result: string | null;
  nextFollowAt: string | null;
  userId: string;
};

type Overview = {
  contracts: Array<{ id: string; contractNo: string; title: string; status: string; serviceType: string; signDate: string; totalAmount: string }>;
  projects: Array<{ id: string; projectNo: string; name: string; status: string; contractNo: string; startDate: string; endDate: string }>;
  invoices: Array<{ id: string; invoiceNo: string; status: string; amount: string; actualIssueDate: string | null; contractNo: string }>;
  payments: Array<{ id: string; paymentNo: string; status: string; amount: string; receiveDate: string; contractNo: string }>;
  totals: { contractCount: number; projectCount: number; invoiceCount: number; paymentCount: number; contractTotal: number; invoicedTotal: number; paidTotal: number };
};

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { isMobile } = useResponsive();
  const customerType = useDict("CUSTOMER_TYPE");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const scaleDict = useDict("CUSTOMER_SCALE");
  const methodDict = useDict("FOLLOW_METHOD");
  const resultDict = useDict("FOLLOW_RESULT");
  const { data, error, isLoading, mutate } = useSWR<Customer>(`/api/customers/${id}`);
  const { data: followUps, mutate: mutateFollowUps } = useSWR<FollowUp[]>(`/api/customers/${id}/follow-ups`);
  const { data: overview, mutate: mutateOverview } = useSWR<Overview>(`/api/customers/${id}/overview`);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("info");

  if (error) {
    return (
      <Page>
        <PageHeader back={() => router.push("/customers")} title="客户详情" />
        <div style={{ marginTop: 12, padding: 16, background: "#fff2f0", color: "#cf1322", borderRadius: 8, fontSize: 13 }}>
          加载失败: {(error as Error).message}{" "}
          <Button size="small" type="link" onClick={() => mutate()}>重试</Button>
        </div>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/customers")} title="客户详情" />
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
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="合同数" value={t?.contractCount ?? 0} suffix="份" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="合同总额" value={t ? fmtWan(t.contractTotal) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="开票总额" value={t ? fmtWan(t.invoicedTotal) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card><Statistic title="回款总额" value={t ? fmtWan(t.paidTotal) : 0} suffix="万" /></Card>
          </Col>
          <Col xs={24}>
            <ProCard>
              <Row gutter={16}>
                <Col xs={12} sm={8}><Statistic title="项目数" value={t?.projectCount ?? 0} suffix="个" /></Col>
                <Col xs={12} sm={8}><Statistic title="开票数" value={t?.invoiceCount ?? 0} suffix="张" /></Col>
                <Col xs={12} sm={8}><Statistic title="回款数" value={t?.paymentCount ?? 0} suffix="笔" /></Col>
              </Row>
            </ProCard>
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
            { title: "详细地址", dataIndex: "address", render: (v) => v || "—", valueType: "textarea" },
            { title: "状态", dataIndex: "status", render: (_, r) => <StatusTag status={r.status as string} domain="customer" /> },
            { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime", render: (_, r) => <DateTimeCell value={r.createdAt as string} /> }
          ]} />
        </ProCard>
      )
    },
    {
      key: "followups",
      label: <span>跟进 ({followUps?.length ?? 0})</span>,
      children: (
        <ProCard>
          <ProTable<FollowUp>
            rowKey="id"
            search={false}
            options={false}
            pagination={{ defaultPageSize: 10, size: isMobile ? "small" : "middle" }}
            dataSource={followUps ?? []}
            scroll={{ x: 'max-content' }}
            sticky={isMobile}
            columns={[
              { title: "跟进时间", dataIndex: "followAt", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.followAt as string} /> },
              { title: "方式", dataIndex: "method", width: 100, render: (v) => methodDict.find((d) => d.code === v)?.label ?? v },
              { title: "内容", dataIndex: "content" },
              { title: "结果", dataIndex: "result", width: 100, render: (v) => v ? (resultDict.find((d) => d.code === v)?.label ?? v) : "—" },
              { title: "下次跟进", dataIndex: "nextFollowAt", width: 140, render: (v) => v ? <DateCell value={v as string} /> : "—" },
              {
                title: "跟进人", dataIndex: "userId", width: 120,
                render: (_, r) => <FollowUpUserName id={r.userId as string} />
              }
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
      key: "projects",
      label: <span>项目 ({overview?.projects.length ?? 0})</span>,
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
                { title: "所属合同", dataIndex: "contractNo", width: 180 },
                { title: "起期", dataIndex: "startDate", width: 120, render: (_, r) => <DateCell value={r.startDate as string} /> },
                { title: "止期", dataIndex: "endDate", width: 120, render: (_, r) => <DateCell value={r.endDate as string} /> },
                { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="project" /> }
              ]} />
          ) : <Empty description="该客户暂无项目" />}
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
        back={() => router.push("/customers")}
        title={`${data.name} (${data.code})`}
        subtitle="客户 360 度视图 — 概览 / 信息 / 跟进 / 合同 / 项目 / 开票 / 回款"
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/customers/${id}/pdf`)}>导出 PDF</Button>
            <Button key="followup" icon={<PlusOutlined />} onClick={() => setFollowUpOpen(true)}>
              新增跟进
            </Button>
            <Button key="edit" type="primary" onClick={() => router.push(`/customers/${id}/edit`)}>
              编辑
            </Button>
          </Space>
        }
        meta={data.status ? <StatusTag status={data.status} domain="customer" /> : null}
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      <FollowUpDrawer
        customerId={id}
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        onSaved={() => { mutateFollowUps(); mutateOverview(); }}
      />
    </Page>
  );
}

function FollowUpUserName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}
