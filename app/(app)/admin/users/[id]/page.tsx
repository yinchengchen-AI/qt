"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Tag, Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { DateCell, DateTimeCell } from "@/components/table-cells";

type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  role: { id: string; code: string; name: string };
  department: { id: string; code: string; name: string } | null;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<User>(`/api/users/${id}`);

  if (error) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <div
          style={{
            marginTop: 12,
            padding: 16,
            background: "#fff2f0",
            color: "#cf1322",
            borderRadius: 8,
            fontSize: 13
          }}
        >
          加载失败: {(error as Error).message}{" "}
          <Button size="small" type="link" onClick={() => mutate()}>
            重试
          </Button>
        </div>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/users")}
        title={`${data.name} (${data.employeeNo})`}
        subtitle={`${data.email} · ${data.role?.name ?? data.roleId}`}
        meta={
          <Tag color={data.status === "ACTIVE" ? "green" : "default"}>
            {data.status === "ACTIVE" ? "启用" : "禁用"}
          </Tag>
        }
        actions={
          <Button type="primary" onClick={() => router.push(`/admin/users/${id}/edit`)}>
            编辑
          </Button>
        }
      />
      <ProCard>
        <ProDescriptions<User>
          column={2}
          dataSource={data}
          columns={[
            { title: "工号", dataIndex: "employeeNo" },
            { title: "姓名", dataIndex: "name" },
            { title: "邮箱", dataIndex: "email" },
            { title: "手机", dataIndex: "phone", render: (_: unknown, r: User) => r.phone ?? "-" },
            {
              title: "角色",
              dataIndex: ["role", "name"],
              render: () => `${data.role?.name ?? "-"} (${data.role?.code ?? ""})`
            },
            { title: "部门", dataIndex: ["department", "name"], render: (_: unknown, r: User) => r.department?.name ?? "-" },
            {
              title: "状态",
              dataIndex: "status",
              render: (_: unknown, r: User) => (
                <Tag color={r.status === "ACTIVE" ? "green" : "default"}>
                  {r.status === "ACTIVE" ? "启用" : "禁用"}
                </Tag>
              )
            },
            {
              title: "最近登录",
              dataIndex: "lastLoginAt",
              render: (_: unknown, r: User) => (r.lastLoginAt ? <DateTimeCell value={r.lastLoginAt} /> : "从未登录")
            },
            { title: "创建时间", dataIndex: "createdAt", render: (_: unknown, r: User) => <DateCell value={r.createdAt} /> },
            { title: "更新时间", dataIndex: "updatedAt", render: (_: unknown, r: User) => <DateCell value={r.updatedAt} /> }
          ]}
        />
      </ProCard>
    </Page>
  );
}
