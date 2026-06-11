"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Tag, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
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

type Customer = {
  id: string; code: string; name: string; shortName: string | null;
  unifiedSocialCreditCode: string | null; customerType: string; industry: string | null; sourceChannel: string | null;
  scale: string | null; level: string; status: string; contactPhone: string;
  contactEmail: string | null; province: string; city: string; address: string | null;
  creditLimitAmount: string | null; paymentTermDays: number; createdAt: string;
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

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");
  const industryDict = useDict("CUSTOMER_INDUSTRY");
  const sourceDict = useDict("CUSTOMER_SOURCE");
  const methodDict = useDict("FOLLOW_METHOD");
  const resultDict = useDict("FOLLOW_RESULT");
  const { data, error, isLoading, mutate } = useSWR<Customer>(`/api/customers/${id}`);
  const { data: followUps, mutate: mutateFollowUps } = useSWR<FollowUp[]>(`/api/customers/${id}/follow-ups`);
  const { data: contracts } = useSWR<Array<Record<string, unknown>>>(`/api/customers/${id}/contracts`);
  const [followUpOpen, setFollowUpOpen] = useState(false);

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
  const levelLabel = customerLevel.find((d) => d.code === data.level)?.label ?? data.level;
  const industryLabel = data.industry ? (industryDict.find((d) => d.code === data.industry)?.label ?? data.industry) : "—";
  const sourceLabel = data.sourceChannel ? (sourceDict.find((d) => d.code === data.sourceChannel)?.label ?? data.sourceChannel) : "—";
  return (
    <Page>
      <PageHeader
        back={() => router.push("/customers")}
        title={`${data.name} (${data.code})`}
        subtitle="客户基础信息、跟进记录与关联合同"
        actions={
          <Space>
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
      <ProCard>
        <ProDescriptions<Customer> column={2} dataSource={data} columns={[
          { title: "客户编号", dataIndex: "code" },
          { title: "客户全称", dataIndex: "name" },
          { title: "简称", dataIndex: "shortName" },
          { title: "统一社会信用代码", dataIndex: "unifiedSocialCreditCode" },
          { title: "类型", dataIndex: "customerType", render: () => typeLabel },
          { title: "等级", dataIndex: "level", render: () => <Tag>{levelLabel}</Tag> },
          { title: "行业", dataIndex: "industry", render: () => industryLabel },
          { title: "客户来源", dataIndex: "sourceChannel", render: () => sourceLabel },
          { title: "所在地区", dataIndex: "province", render: (_, r) => `${r.province} / ${r.city}` },
          { title: "详细地址", dataIndex: "address" },
          { title: "联系电话", dataIndex: "contactPhone" },
          { title: "邮箱", dataIndex: "contactEmail" },
          { title: "授信额度", dataIndex: "creditLimitAmount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "账期(天)", dataIndex: "paymentTermDays" },
          { title: "创建时间", dataIndex: "createdAt", render: (v) => <DateCell value={v as string} /> }
        ]} />
      </ProCard>
      <PageHeader level="section" title="跟进记录" />
      <ProCard>
        <ProTable<FollowUp>
          rowKey="id"
          search={false}
          options={false}
          pagination={{ pageSize: 5 }}
          dataSource={followUps ?? []}
          columns={[
            { title: "时间", dataIndex: "followAt", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.followAt} /> },
            {
              title: "方式",
              dataIndex: "method",
              width: 100,
              render: (_, r) => methodDict.find((d) => d.code === r.method)?.label ?? r.method
            },
            { title: "内容", dataIndex: "content" },
            {
              title: "结果",
              dataIndex: "result",
              width: 100,
              render: (_, r) => r.result ? (resultDict.find((d) => d.code === r.result)?.label ?? r.result) : "—"
            },
            {
              title: "跟进人",
              dataIndex: "userId",
              width: 100,
              render: (_, r) => <FollowUpUserName id={r.userId} />
            },
            {
              title: "下次跟进",
              dataIndex: "nextFollowAt",
              width: 160,
              render: (_, r) => r.nextFollowAt ? <DateTimeCell value={r.nextFollowAt} /> : "—"
            }
          ]}
        />
      </ProCard>
      <PageHeader level="section" title="关联合同" />
      <ProCard>
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 5 }} dataSource={contracts ?? []} columns={[
          { title: "合同号", dataIndex: "contractNo", width: 180 },
          { title: "标题", dataIndex: "title" },
          { title: "签订日", dataIndex: "signDate", valueType: "date", width: 120, render: (_, r) => <DateCell value={r.signDate as string} /> },
          { title: "总额(元)", dataIndex: "totalAmount", width: 140, render: (_, r) => <CurrencyCell value={r.totalAmount as string} /> },
          { title: "状态", dataIndex: "status", width: 100, render: (_, r) => <StatusTag status={r.status as string} domain="contract" /> }
        ]} />
      </ProCard>
      <FollowUpDrawer
        customerId={id}
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        onSaved={() => mutateFollowUps()}
      />
    </Page>
  );
}

// 把 userId 解析成姓名;组件拆出来是因为 useUserName 必须在 SWR 数据解析后调用,
// 直接写在 render 闭包里行不通(SWR 初始为 undefined → useUserName 拿不到 id)
function FollowUpUserName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}
