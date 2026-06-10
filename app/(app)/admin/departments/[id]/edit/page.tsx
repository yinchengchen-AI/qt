"use client";
import { ProForm, ProFormText, ProFormTreeSelect, ProFormDigit, ProFormSwitch } from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { FormPageSkeleton } from "@/components/form-page-skeleton";

const { Text } = Typography;

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sort: number;
  isActive: boolean;
  memberCount: number;
  childCount: number;
};

type DeptTreeNode = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  children?: DeptTreeNode[];
};

function buildTreeSelectData(list: DeptTreeNode[]): { value: string; title: string; children?: unknown[] }[] {
  return list.map((d) => ({
    value: d.id,
    title: `${d.name} (${d.code})`,
    children: d.children ? buildTreeSelectData(d.children) : undefined
  }));
}

/** 过滤掉当前节点及其所有后代（防止把部门挂到自己下） */
function filterOutSelfAndDescendants(
  list: DeptTreeNode[],
  selfId: string
): DeptTreeNode[] {
  const isDescendant = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const node = list.find((n) => n.id === id);
    if (!node) return false;
    if (node.id === selfId) return true;
    if (node.parentId && isDescendant(node.parentId, seen)) return true;
    return false;
  };
  const filter = (nodes: DeptTreeNode[]): DeptTreeNode[] =>
    nodes
      .filter((n) => !isDescendant(n.id))
      .map((n) => ({
        ...n,
        children: n.children ? filter(n.children) : undefined
      }));
  return filter(list);
}

export default function EditDepartmentPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data, isLoading } = useSWR<Dept>(`/api/departments/${id}`);

  if (isLoading || !data) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/admin/departments/${id}`)} title="编辑部门" />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/admin/departments/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle={`${data.memberCount} 名成员 / ${data.childCount} 个子部门`}
      />
      <FormCard headerHint="代码 / 名称 / 上级部门可改;停用后业务查询会自动过滤;上级不能选自己或自己后代">
        <ProForm
          layout="vertical"
          initialValues={{
            code: data.code,
            name: data.name,
            parentId: data.parentId ?? undefined,
            sort: data.sort,
            isActive: data.isActive
          }}
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存" },
            resetButtonProps: { style: { display: "none" } }
          }}
          onFinish={async (values) => {
            const res = await fetch(`/api/departments/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                code: values.code,
                name: values.name,
                parentId: values.parentId || null,
                sort: values.sort,
                isActive: values.isActive
              })
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("已保存");
            router.push(`/admin/departments/${id}`);
            return true;
          }}
        >
          <FormSection title="基本信息">
            <FormGrid columns={2}>
              <ProFormText
                name="code"
                label="代码"
                rules={[
                  { required: true, max: 30 },
                  { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: "字母开头,允许字母/数字/-/_" }
                ]}
                fieldProps={{ size: "large", maxLength: 30, showCount: true }}
              />
              <ProFormText
                name="name"
                label="名称"
                rules={[{ required: true, max: 50 }]}
                fieldProps={{ size: "large", maxLength: 50, showCount: true }}
              />
              <ProFormTreeSelect
                name="parentId"
                label="上级部门"
                placeholder="不选 = 顶级"
                allowClear
                fieldProps={{
                  size: "large",
                  showSearch: true,
                  treeDefaultExpandAll: true,
                  treeNodeFilterProp: "title"
                }}
                request={async () => {
                  const r = await fetch("/api/departments?pageSize=200&tree=true", {
                    credentials: "include"
                  });
                  const j = await r.json();
                  if (j.code !== 0) return [];
                  return buildTreeSelectData(filterOutSelfAndDescendants(j.data.tree ?? [], id));
                }}
              />
              <ProFormDigit
                name="sort"
                label="排序"
                min={0}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="状态">
            <FormGrid columns={1}>
              <ProFormSwitch
                name="isActive"
                label="启用"
                tooltip="停用后该部门成员在筛选 / 列表中不再展示此部门"
              />
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  停用 <Tag>isActive = false</Tag> 不会删除成员,仅业务查询过滤;
                  有子部门 / 成员的部门不可删,可先停用
                </Text>
              </Space>
            </FormGrid>
          </FormSection>
        </ProForm>
      </FormCard>
    </Page>
  );
}
