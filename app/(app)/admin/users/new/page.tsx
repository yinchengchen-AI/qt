"use client";
import { ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Card, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";

const { Text } = Typography;

type Role = { id: string; code: string; name: string };

export default function NewUserPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: rolesResp } = useSWR<{ data: { list: Role[] } }>("/api/roles?pageSize=100");
  const roleOptions = (rolesResp?.data?.list ?? []).map((r) => ({
    value: r.id,
    label: `${r.name} (${r.code})`
  }));

  return (
    <Page compact>
      <PageHeader
        back={() => router.push("/admin/users")}
        title="新建用户"
        subtitle="新建账号默认密码 123456,可在列表中重置"
      />
      <FormCard headerHint="工号、邮箱全局唯一;角色决定权限矩阵;自己不能改自己(后端护栏)">
        <ProForm
          layout="vertical"
          initialValues={{ status: "ACTIVE" }}
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存" },
            resetButtonProps: { style: { display: "none" } }
          }}
          onFinish={async (values) => {
            const res = await fetch("/api/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(values)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("创建成功");
            router.push(`/admin/users/${j.data.id}`);
            return true;
          }}
        >
          <FormSection title="账号信息">
            <FormGrid columns={2}>
              <ProFormText
                name="employeeNo"
                label="工号"
                placeholder="如:zhangsan 或 z001"
                rules={[{ required: true, max: 40, message: "工号必填, ≤ 40 字符" }]}
                fieldProps={{ size: "large", maxLength: 40, showCount: true }}
              />
              <ProFormText
                name="name"
                label="姓名"
                placeholder="如:张三"
                rules={[{ required: true, max: 40, message: "姓名必填" }]}
                fieldProps={{ size: "large", maxLength: 40, showCount: true }}
              />
              <ProFormText
                name="email"
                label="邮箱"
                placeholder="如:zhangsan@example.com"
                rules={[
                  { required: true, type: "email", message: "请输入正确邮箱" },
                  { max: 120 }
                ]}
                fieldProps={{ size: "large", maxLength: 120 }}
              />
              <ProFormText
                name="phone"
                label="手机号"
                placeholder="可空"
                fieldProps={{ size: "large", maxLength: 20 }}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="角色与部门">
            <FormGrid columns={2}>
              <ProFormSelect
                name="roleId"
                label="角色"
                placeholder="请选择"
                options={roleOptions}
                showSearch
                rules={[{ required: true, message: "请选择角色" }]}
                fieldProps={{ size: "large", optionFilterProp: "label" }}
              />
              <DepartmentTreeSelect
                label="部门"
                placeholder="如:技术部 / 财务部"
              />
            </FormGrid>
          </FormSection>

          <FormSection title="初始状态">
            <FormGrid columns={1}>
              <ProFormSelect
                name="status"
                label="状态"
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "DISABLED", label: "禁用" }
                ]}
                rules={[{ required: true, message: "请选择状态" }]}
                fieldProps={{ size: "large" }}
              />
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  默认 <Tag color="green">ACTIVE 启用</Tag>;
                  选 <Tag>DISABLED</Tag> 状态会立即禁止该账号登录
                </Text>
              </Space>
            </FormGrid>
          </FormSection>
        </ProForm>
      </FormCard>
    </Page>
  );
}
