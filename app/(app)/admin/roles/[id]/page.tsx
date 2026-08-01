"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Tag, Button, Space } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { DateCell } from "@/components/table-cells";
import { useGoBack } from "@/lib/navigation";
import { PermissionMatrix, type Permission } from "@/components/admin/permission-matrix";

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function RoleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const goBack = useGoBack("/admin/roles");
  const { data, error, isLoading, mutate } = useSWR<Role>(`/api/roles/${id}`);

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="角色详情" />
        <div style={{ marginTop: 12 }}>
          <ErrorBox
            title="加载失败"
            action={
              <Button size="small" onClick={() => mutate()}>
                重试
              </Button>
            }
          >
            {(error as Error).message}
          </ErrorBox>
        </div>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={goBack} title="角色详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`${data.name}（${data.code}）`}
        subtitle={data.description ?? "—"}
        meta={data.isSystem ? <Tag color="blue">系统角色</Tag> : <Tag>自定义角色</Tag>}
        actions={
          <Space>
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => router.push(`/admin/roles/${id}/edit`)}
            >
              编辑权限
            </Button>
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions<Role>
          column={DESC_COL}
          dataSource={data}
          columns={[
            { title: "代码", dataIndex: "code" },
            { title: "名称", dataIndex: "name" },
            {
              title: "类型",
              dataIndex: "isSystem",
              render: (_: unknown, r: Role) =>
                r.isSystem ? <Tag color="blue">系统</Tag> : <Tag>自定义</Tag>
            },
            { title: "说明", dataIndex: "description", render: (_: unknown, r: Role) => r.description ?? "-" },
            { title: "创建时间", dataIndex: "createdAt", render: (_: unknown, r: Role) => <DateCell value={r.createdAt} /> },
            { title: "更新时间", dataIndex: "updatedAt", render: (_: unknown, r: Role) => <DateCell value={r.updatedAt} /> }
          ]}
        />
      </ProCard>

      <PageHeader level="section" title={`权限矩阵 (${data.permissions.length} 资源)`} />
      <ProCard>
        <PermissionMatrix value={data.permissions} readOnly />
      </ProCard>

    </Page>
  );
}
