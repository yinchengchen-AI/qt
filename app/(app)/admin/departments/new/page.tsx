"use client";
import { ProForm, ProFormText, ProFormTreeSelect, ProFormDigit } from "@ant-design/pro-components";
import { App as AntdApp, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";

const { Text } = Typography;

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  children?: Dept[];
};

function buildTreeSelectData(list: Dept[]): { value: string; title: string; children?: unknown[] }[] {
  return list.map((d) => ({
    value: d.id,
    title: `${d.name} (${d.code})`,
    children: d.children ? buildTreeSelectData(d.children) : undefined
  }));
}

export default function NewDepartmentPage() {
  const router = useRouter();
  const goBack = useGoBack("/admin/departments");
  const { message } = AntdApp.useApp();

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="新建部门"
        subtitle="树形结构;选上级部门可挂为子部门;不选则为顶级"
      />
      <FormCard headerHint="代码全局唯一,创建后仍可改;上级部门可选;不选为顶级">
        <ProForm
          layout="vertical"
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存" },
            resetButtonProps: { style: { display: "none" } }
          }}
          onFinish={async (values) => {
            const res = await fetch("/api/departments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                code: values.code,
                name: values.name,
                parentId: values.parentId || undefined,
                sort: values.sort ?? 0
              })
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("创建成功");
            router.push(`/admin/departments/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="基本信息">
            <FormGrid columns={2}>
              <ProFormText
                name="code"
                label="代码"
                placeholder="如 技术部 / 技术一组"
                rules={[
                  { required: true, max: 30 },
                  { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: "字母开头,允许字母/数字/-/_" }
                ]}
                fieldProps={{ size: "large", maxLength: 30, showCount: true }}
              />
              <ProFormText
                name="name"
                label="名称"
                placeholder="如:技术部"
                rules={[{ required: true, max: 50 }]}
                fieldProps={{ size: "large", maxLength: 50, showCount: true }}
              />
              <ProFormTreeSelect
                name="parentId"
                label="上级部门"
                placeholder="不选 = 顶级部门"
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
                  return buildTreeSelectData(j.data.tree ?? []);
                }}
              />
              <ProFormDigit
                name="sort"
                label="排序"
                placeholder="数字小排前;默认 0"
                min={0}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
          </FormSection>

          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              顶级部门可后续挂为其它部门的子部门;现有成员的部门编号 不会变化,外键仍指向原部门。
            </Text>
          </Space>
        </ProForm>
      </FormCard>
    </Page>
  );
}
