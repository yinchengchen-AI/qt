"use client";
import { ProCard, ProDescriptions, ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Space, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { DateCell } from "@/components/table-cells";

const { Text } = Typography;

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parent?: { id: string; code: string; name: string } | null;
  sort: number;
  isActive: boolean;
  memberCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
};

type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  status: string;
  role?: { name: string };
};

export default function DepartmentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/admin/departments");
  const { data, error, isLoading, mutate } = useSWR<Dept>(`/api/departments/${id}`);
  const { data: membersData } = useSWR<{ list: User[]; total: number }>(
    data ? `/api/users?pageSize=50&departmentId=${id}` : null
  );

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="部门详情" />
        <ProCard>
          <Text type="danger">加载失败:{(error as Error).message}</Text>
        </ProCard>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={goBack} title="部门详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const memberColumns: ProColumns<User>[] = [
    { title: "工号", dataIndex: "employeeNo", width: 100 },
    { title: "姓名", dataIndex: "name", width: 120 },
    { title: "邮箱", dataIndex: "email", width: 200, ellipsis: true },
    {
      title: "角色",
      dataIndex: ["role", "name"],
      width: 100,
      render: (_, r) => r.role?.name ?? "-"
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (_: unknown, r: User) => <Tag color={r.status === "ACTIVE" ? "green" : "default"}>{r.status === "ACTIVE" ? "启用" : "禁用"}</Tag>
    }
  ];

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`${data.name}（${data.code}）`}
        subtitle={data.parent ? `隶属于：${data.parent.name}（${data.parent.code}）` : "顶级部门"}
        meta={data.isActive ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
        actions={
          <Space>
            <Button onClick={() => mutate()}>刷新</Button>
            <Button type="primary" onClick={() => router.push(`/admin/departments/${id}/edit`)}>
              编辑
            </Button>
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<Dept>
          column={3}
          dataSource={data}
          columns={[
            { title: "代码", dataIndex: "code" },
            { title: "名称", dataIndex: "name" },
            { title: "排序", dataIndex: "sort" },
            { title: "上级", dataIndex: ["parent", "name"], render: () => data.parent?.name ?? "—（顶级）" },
            { title: "成员数", dataIndex: "memberCount", render: (_: unknown, r: Dept) => <Tag color={r.memberCount > 0 ? "green" : "default"}>{r.memberCount} 人</Tag> },
            { title: "子部门", dataIndex: "childCount", render: (_: unknown, r: Dept) => <Tag color={r.childCount > 0 ? "blue" : "default"}>{r.childCount} 个</Tag> },
            { title: "创建时间", dataIndex: "createdAt", render: (_: unknown, r: Dept) => <DateCell value={r.createdAt} /> },
            { title: "更新时间", dataIndex: "updatedAt", render: (_: unknown, r: Dept) => <DateCell value={r.updatedAt} /> }
          ]}
        />
      </ProCard>

      <PageHeader level="section" title={`部门成员 (${data.memberCount})`} />
      <ProTable<User>
        rowKey="id"
        search={false}
        loading={!membersData}
        pagination={{ defaultPageSize: 50, total: membersData?.total ?? 0, showSizeChanger: false }}
        dataSource={membersData?.list ?? []}
        columns={memberColumns}
      />
    </Page>
  );
}
