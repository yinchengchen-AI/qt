"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Tag, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useDict } from "@/lib/dict-client";

type Customer = {
  id: string; code: string; name: string; shortName: string | null;
  unifiedSocialCreditCode: string | null; customerType: string; industry: string | null;
  scale: string | null; level: string; status: string; contactPhone: string;
  contactEmail: string | null; province: string; city: string; address: string | null;
  creditLimitAmount: string | null; paymentTermDays: number; createdAt: string;
};

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const customerType = useDict("CUSTOMER_TYPE");
  const customerLevel = useDict("CUSTOMER_LEVEL");
  const { data, error, isLoading } = useSWR<Customer>(`/api/customers/${id}`);
  const { data: followUps } = useSWR<Array<any>>(`/api/customers/${id}/follow-ups`);
  const { data: contracts } = useSWR<Array<any>>(`/api/customers/${id}/contracts`);

  if (error) return <ProCard>加载失败：{(error as Error).message}</ProCard>;
  if (isLoading || !data) return <ProCard>加载中…</ProCard>;
  const typeLabel = customerType.find((d) => d.code === data.customerType)?.label ?? data.customerType;
  const levelLabel = customerLevel.find((d) => d.code === data.level)?.label ?? data.level;
  return (
    <ProCard
      title={<span onClick={() => router.push("/customers")} style={{ cursor: "pointer" }}>← {data.name} ({data.code})</span>}
      extra={[<Button key="edit" type="primary" onClick={() => router.push(`/customers/${id}/edit`)}>编辑</Button>]}
    >
      <ProDescriptions<Customer> column={2} dataSource={data} columns={[
        { title: "客户编号", dataIndex: "code" },
        { title: "客户全称", dataIndex: "name" },
        { title: "简称", dataIndex: "shortName" },
        { title: "统一社会信用代码", dataIndex: "unifiedSocialCreditCode" },
        { title: "类型", dataIndex: "customerType", render: () => typeLabel },
        { title: "等级", dataIndex: "level", render: () => <Tag>{levelLabel}</Tag> },
        { title: "状态", dataIndex: "status", render: (_, r) => <Tag color="blue">{r.status}</Tag> },
        { title: "行业", dataIndex: "industry" },
        { title: "所在地区", dataIndex: "province", render: (_, r) => `${r.province} / ${r.city}` },
        { title: "详细地址", dataIndex: "address" },
        { title: "联系电话", dataIndex: "contactPhone" },
        { title: "邮箱", dataIndex: "contactEmail" },
        { title: "授信额度", dataIndex: "creditLimitAmount", render: (v: any) => (v ? `¥${v}` : "-") },
        { title: "账期（天）", dataIndex: "paymentTermDays" }
      ]} />
      <ProCard title="跟进记录" style={{ marginTop: 16 }}>
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 5 }} dataSource={followUps ?? []} columns={[
          { title: "时间", dataIndex: "followAt", valueType: "dateTime", width: 180 },
          { title: "方式", dataIndex: "method", width: 100 },
          { title: "内容", dataIndex: "content" },
          { title: "结果", dataIndex: "result", width: 100 }
        ]} />
      </ProCard>
      <ProCard title="关联合同" style={{ marginTop: 16 }}>
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 5 }} dataSource={contracts ?? []} columns={[
          { title: "合同号", dataIndex: "contractNo", width: 180 },
          { title: "标题", dataIndex: "title" },
          { title: "签订日", dataIndex: "signDate", valueType: "date", width: 120 },
          { title: "总额（元）", dataIndex: "totalAmount", width: 140, render: (v: any) => `¥${v}` },
          { title: "状态", dataIndex: "status", width: 100, render: (_, r: any) => <Tag>{r.status}</Tag> }
        ]} />
      </ProCard>
    </ProCard>
  );
}
