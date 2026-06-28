"use client";
import { ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Button, Space, Tag, theme, Typography } from "antd";
import { CheckCircleOutlined, EditOutlined, IdcardOutlined, MailOutlined, PhoneOutlined, StopOutlined, UserOutlined, ApartmentOutlined, ArrowRightOutlined, LockOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { ErrorBox } from "@/components/callout";

const { Text } = Typography;

type Role = { id: string; code: string; name: string };

type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  role: Role;
  departmentId: string | null;
  department: { id: string; code: string; name: string } | null;
  status: "ACTIVE" | "DISABLED";
};

// P0-4: 旧 edit 页缩成账号信息编辑(name/email/phone/role/department/status)。
// 档案编辑走 /admin/users/[id]/edit-profile(PR4 5 步向导)。
export default function EditUserPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/admin/users");
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();

  const { data: userResp, error, isLoading } = useSWR<User>(`/api/users/${id}`);
  const { data: rolesResp } = useSWR<{ list: Role[] }>("/api/roles?pageSize=100");

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑账号" />
        <ErrorBox title="加载失败">{(error as Error).message}</ErrorBox>
      </Page>
    );
  }
  if (isLoading || !userResp) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑账号" />
        <FormPageSkeleton />
      </Page>
    );
  }

  const user = userResp;
  const roleOptions = (rolesResp?.list ?? []).map((r) => ({
    value: r.id,
    label: (
      <Space size={6}>
        <span>{r.name}</span>
        <span style={{ color: "var(--qt-text-faint)", fontSize: 12 }}>({r.code})</span>
      </Space>
    )
  }));

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`编辑账号 — ${user.name}`}
        subtitle={
          <Space size={8} wrap>
            <Tag color="blue" style={{ margin: 0 }}>{user.employeeNo}</Tag>
            <Text style={{ color: "var(--qt-text-muted)", fontSize: 13 }}>工号 / 邮箱全局唯一;角色决定权限矩阵</Text>
          </Space>
        }
      />

      <FormCard
        headerHint={
          <Space size={8} align="start">
            <span>本页只编辑账号信息(姓名/邮箱/手机/角色/部门/状态)。</span>
            <span>员工档案(基础/岗位合同/敏感/履历/证书与附件)请用 5 步向导编辑。</span>
            <Button
              type="primary"
              size="small"
              icon={<EditOutlined />}
              onClick={() => router.push(`/admin/users/${id}/edit-profile`)}
            >
              打开档案向导
              <ArrowRightOutlined />
            </Button>
          </Space>
        }
      >
        <ProForm
          layout="vertical"
          submitter={{
            searchConfig: { resetText: "重置", submitText: "保存" },
            resetButtonProps: { style: { display: "none" } },
            render: (_: unknown, dom: React.ReactNode) => (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 8,
                  paddingTop: 16,
                  borderTop: "1px solid var(--qt-border-soft)"
                }}
              >
                {dom}
              </div>
            )
          }}
          initialValues={{
            name: user.name,
            employeeNo: user.employeeNo,
            email: user.email,
            phone: user.phone ?? undefined,
            roleId: user.roleId,
            departmentId: user.departmentId ?? undefined,
            status: user.status
          }}
          onFinish={async (values) => {
            const payload = {
              name: values.name,
              email: values.email,
              phone: values.phone || null,
              roleId: values.roleId,
              departmentId: values.departmentId || null,
              status: values.status
            };
            const res = await fetch(`/api/users/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("账号已保存");
            router.push(`/admin/users/${id}`);
            return true;
          }}
        >
          <FormSection
            title="账号信息"
            description="登录身份；工号创建后不可修改"
            icon={<UserOutlined />}
          >
            <FormGrid columns={2}>
              <ProFormText
                name="name"
                label="姓名"
                tooltip="此处显示工号用于核对；该字段不可修改"
                rules={[{ required: true, max: 40, message: "姓名必填" }]}
                fieldProps={{ size: "large", maxLength: 40, showCount: true, prefix: <UserOutlined /> }}
              />
              <ProFormText
                name="employeeNo"
                label="工号"
                tooltip="工号创建后不可修改"
                fieldProps={{ size: "large", disabled: true, prefix: <IdcardOutlined /> }}
              />
              <ProFormText
                name="email"
                label="邮箱"
                rules={[
                  { required: true, type: "email", message: "请输入正确邮箱" },
                  { max: 120 }
                ]}
                fieldProps={{ size: "large", maxLength: 120, prefix: <MailOutlined /> }}
              />
              <ProFormText
                name="phone"
                label="手机号"
                fieldProps={{ size: "large", maxLength: 20, prefix: <PhoneOutlined /> }}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="角色与部门"
            description="决定权限范围（角色）与组织归属（部门）"
            icon={<ApartmentOutlined />}
          >
            <FormGrid columns={2}>
              <ProFormSelect
                name="roleId"
                label="角色"
                placeholder="请选择"
                options={roleOptions}
                rules={[{ required: true, message: "请选择角色（决定权限范围）" }]}
                fieldProps={{ size: "large", optionFilterProp: "label" }}
              />
              <DepartmentTreeSelect label="部门" placeholder="不选则不归属任何部门" />
            </FormGrid>
          </FormSection>

          <FormSection
            title="账号状态"
            description="停用后该账号将无法登录系统，但历史数据保留"
            icon={<LockOutlined />}
          >
            <ProFormSelect
              name="status"
              label="状态"
              options={[
                {
                  value: "ACTIVE",
                  label: (
                    <Space size={6}>
                      <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                      <span>启用</span>
                    </Space>
                  )
                },
                {
                  value: "DISABLED",
                  label: (
                    <Space size={6}>
                      <StopOutlined style={{ color: token.colorError }} />
                      <span>禁用</span>
                    </Space>
                  )
                }
              ]}
              rules={[{ required: true }]}
              fieldProps={{ size: "large" }}
            />
          </FormSection>
        </ProForm>
      </FormCard>
    </Page>
  );
}
