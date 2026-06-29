"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Col, Empty, Row, Space, Tabs } from "antd";
import { FilePdfOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { useState } from "react";
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
import { serviceTypeLabel } from "@/lib/enum-maps";

type Customer = {
  id: string; code: string; name: string; shortName: string | null;
  unifiedSocialCreditCode: string | null; customerType: string; industry: string | null; sourceChannel: string | null;
  scale: string | null;
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
              { title: "服务类型", dataIndex: "serviceType", width: 120, render: (v: unknown) => serviceTypeLabel(v) },
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
          ) : <Empty description="该客户暂无开票记录，请先创建开票" />}
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
          ) : <Empty description="该客户暂无回款记录，请先登记回款" />}
        </ProCard>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`${data.name}（${data.code}）`}
        subtitle="客户 360 度视图：概览 / 基本信息 / 合同 / 项目 / 开票 / 回款"
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/customers/${id}/pdf`)}>导出 PDF</Button>
            <Button key="edit" type="primary" onClick={() => router.push(`/customers/${id}/edit`)}>
              编辑
            </Button>
          </Space>
        }
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Page>
  );
}

