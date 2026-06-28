"use client";
import { ProForm, ProFormText, ProFormSelect } from "@ant-design/pro-components";
import { App as AntdApp, Modal, Space, Typography, Button, Input, Alert, theme } from "antd";
import { CheckCircleOutlined, CopyOutlined, KeyOutlined, SafetyCertificateOutlined, StopOutlined, UserOutlined, ApartmentOutlined, MailOutlined, PhoneOutlined, IdcardOutlined } from "@ant-design/icons";
import { copyToClipboard } from "@/lib/copy";
import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormSection, FormGrid, FormCard } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";

const { Text } = Typography;

type Role = { id: string; code: string; name: string };

export default function NewUserPage() {
  const router = useRouter();
  const goBack = useGoBack("/admin/users");
  const { message, modal } = AntdApp.useApp();
  const { token } = theme.useToken();
  const { data: rolesResp } = useSWR<{ list: Role[] }>("/api/roles?pageSize=100");
  const roleOptions = (rolesResp?.list ?? []).map((r) => ({
    value: r.id,
    label: (
      <Space size={6}>
        <span>{r.name}</span>
        <Text type="secondary" style={{ fontSize: 12 }}>({r.code})</Text>
      </Space>
    )
  }));

  // PR7: 两段式弹窗保持和 e2e 一致 — 先弹初始密码(info),关闭后再问要不要补档案(confirm)
  function showInitialPassword(initialPassword: string, userId: string, employeeNo: string) {
    Modal.info({
      icon: <KeyOutlined style={{ color: token.colorPrimary }} />,
      title: "账号已创建,初始密码如下(只显示一次)",
      width: 480,
      content: (
        <div style={{ paddingTop: 8 }}>
          <Alert
            type="info"
            showIcon
            message="初始密码仅显示一次"
            description="请立即转交给本人，并要求首次登录后修改。建议使用密码管理器传递，密码不会再次明文展示。"
            style={{ marginBottom: 16 }}
          />
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--qt-text-muted)" }}>初始密码</div>
          <Input.Group compact style={{ display: "flex" }}>
            <Input
              readOnly
              value={initialPassword}
              style={{
                flex: 1,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 16,
                letterSpacing: 1,
                color: token.colorPrimary
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={async () => {
                const ok = await copyToClipboard(initialPassword);
                if (ok) message.success("已复制到剪贴板");
                else message.error("自动复制失败，请用鼠标选中后按 Ctrl + C 手动复制");
              }}
            >
              复制
            </Button>
          </Input.Group>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 12 }}>
            请记录或复制后点击「知道了」继续。
          </Text>
        </div>
      ),
      onOk: () => askCompleteProfile(userId, employeeNo)
    });
  }

  function askCompleteProfile(userId: string, employeeNo: string) {
    modal.confirm({
      title: `账号 ${employeeNo} 创建成功`,
      content: (
        <Space orientation="vertical" size={4}>
          <span>要现在补全员工档案吗?</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            基础/岗位/履历/证书 5 步可一键填完,后续也能在详情页再打开。
          </Text>
        </Space>
      ),
      okText: (
        <Space size={4}>
          <SafetyCertificateOutlined />
          现在补全档案
        </Space>
      ),
      cancelText: "稍后再说",
      onOk: () => router.push(`/admin/users/${userId}/edit-profile`),
      onCancel: () => router.push(`/admin/users/${userId}`)
    });
  }

  return (
    <Page compact>
      <PageHeader
        back={goBack}
        title="新建用户"
        subtitle="系统会生成 10 位随机初始密码，创建后请立即转交给本人，后续可在列表中重置"
      />
      <FormCard headerHint="工号、邮箱全局唯一；角色决定权限范围；管理员不能修改自己的角色（后端校验）">
        <ProForm
          layout="vertical"
          initialValues={{ status: "ACTIVE" }}
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
            message.success("员工已创建，初始密码已生成");
            const initialPassword: string | undefined = j.data.initialPassword;
            if (initialPassword) {
              showInitialPassword(initialPassword, j.data.id, j.data.employeeNo);
            } else {
              askCompleteProfile(j.data.id, j.data.employeeNo);
            }
            return true;
          }}
        >
          <FormSection
            title="账号信息"
            description="登录身份、工号创建后不可修改"
            icon={<UserOutlined />}
          >
            <FormGrid columns={2}>
              <ProFormText
                name="employeeNo"
                label="工号"
                placeholder="如：zs001（登录名）"
                rules={[{ required: true, max: 40, message: "工号必填，不超过 40 个字符" }]}
                fieldProps={{ size: "large", maxLength: 40, showCount: true, prefix: <IdcardOutlined /> }}
              />
              <ProFormText
                name="name"
                label="姓名"
                placeholder="如：张三"
                rules={[{ required: true, max: 40, message: "姓名必填" }]}
                fieldProps={{ size: "large", maxLength: 40, showCount: true, prefix: <UserOutlined /> }}
              />
              <ProFormText
                name="email"
                label="邮箱"
                placeholder="如：zs@example.com"
                rules={[
                  { required: true, type: "email", message: "请输入正确的邮箱地址" },
                  { max: 120 }
                ]}
                fieldProps={{ size: "large", maxLength: 120, prefix: <MailOutlined /> }}
              />
              <ProFormText
                name="phone"
                label="手机号"
                placeholder="选填，请输入手机号"
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
                showSearch
                rules={[{ required: true, message: "请选择角色（决定权限范围）" }]}
                fieldProps={{ size: "large", optionFilterProp: "label" }}
              />
              <DepartmentTreeSelect
                label="部门"
                placeholder="如：技术部 / 财务部"
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="初始状态"
            description="新建后是否立即可登录；停用状态下账号无法登录系统"
            icon={<CheckCircleOutlined />}
          >
            <FormGrid columns={1}>
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
                        <Text type="secondary" style={{ fontSize: 12 }}>创建后立即可登录</Text>
                      </Space>
                    )
                  },
                  {
                    value: "DISABLED",
                    label: (
                      <Space size={6}>
                        <StopOutlined style={{ color: token.colorError }} />
                        <span>禁用</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>创建后无法登录(等准备好再启用)</Text>
                      </Space>
                    )
                  }
                ]}
                rules={[{ required: true, message: "请选择账号初始状态" }]}
                fieldProps={{ size: "large" }}
              />
            </FormGrid>
          </FormSection>
        </ProForm>
      </FormCard>
    </Page>
  );
}
