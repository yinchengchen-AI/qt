"use client";
import {
  ProForm,
  ProFormText,
  ProFormSelect,
  ProFormDatePicker,
  ProFormDigit,
  ProFormTextArea,
  ProCard
} from "@ant-design/pro-components";
import { App as AntdApp, Space, Tag, Typography, Alert, Row, Col, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { FormGrid } from "@/components/form";
import { DepartmentTreeSelect } from "@/components/admin/department-tree-select";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { useDict } from "@/lib/dict-client";
import type { EmployeeProfileDto } from "@/lib/types/employee-profile";
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import { uploadFileToMinIO } from "@/lib/upload-client";

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

const GENDER_OPTIONS = [
  { value: "MALE", label: "男" },
  { value: "FEMALE", label: "女" },
  { value: "OTHER", label: "其他" }
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "FULL_TIME", label: "全职" },
  { value: "PART_TIME", label: "兼职" },
  { value: "INTERN", label: "实习" },
  { value: "CONTRACTOR", label: "外包" }
];

const ANCHOR_ITEMS = [
  { key: "account", title: "账号信息" },
  { key: "role", title: "角色与部门" },
  { key: "status", title: "账号状态" },
  { key: "profile-basic", title: "档案：基础信息" },
  { key: "profile-position", title: "档案：岗位与合同" },
  { key: "profile-sensitive", title: "档案：敏感信息" },
  { key: "profile-remark", title: "档案：履历与备注" }
];

function AnchorNav({ items, offsetTop = 80 }: { items: { key: string; title: string }[]; offsetTop?: number }) {
  const [active, setActive] = useState<string>(items[0]?.key ?? "");

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item) continue;
        const el = document.getElementById(item.key);
        if (el && el.offsetTop - offsetTop - 20 <= scrollTop) {
          setActive(item.key);
          break;
        }
      }
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [items, offsetTop]);

  return (
    <div
      style={{
        position: "sticky",
        top: offsetTop,
        background: "var(--qt-bg-card, #fff)",
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--qt-border, #f0f0f0)"
      }}
    >
      {items.map((item) => (
        <div
          key={item.key}
          role="button"
          tabIndex={0}
          onClick={() => {
            document.getElementById(item.key)?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActive(item.key);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              document.getElementById(item.key)?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActive(item.key);
            }
          }}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            borderRadius: 4,
            color: active === item.key ? "#1677ff" : "inherit",
            background: active === item.key ? "#e6f4ff" : "transparent",
            marginBottom: 4,
            fontSize: 14
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}

export default function EditUserPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const { message } = AntdApp.useApp();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  const { data, isLoading } = useSWR<User>(`/api/users/${id}`);
  const { data: rolesResp } = useSWR<{ list: Role[] }>("/api/roles?pageSize=100");
  const { data: profileResp, isLoading: profileLoading } = useSWR<{ data: EmployeeProfileDto | null }>(
    `/api/users/${id}/profile`
  );
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  const roleOptions = (rolesResp?.list ?? []).map((r) => ({
    value: r.id,
    label: r.name
  }));
  const educationOptions = educationDict.map((d) => ({ value: d.code, label: d.label }));
  const contractTypeOptions = contractTypeDict.map((d) => ({ value: d.code, label: d.label }));

  const profile = profileResp?.data;

  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>(
    () =>
      profile?.attachments.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size
      })) ?? []
  );

  // profile 异步加载完成后同步附件列表
  useEffect(() => {
    if (profile) {
      setAttachmentItems(
        profile.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size
        }))
      );
    }
  }, [profile]);

  const [uploading, setUploading] = useState(false);

  const initialValues = {
    name: data?.name,
    email: data?.email,
    phone: data?.phone ?? undefined,
    roleId: data?.roleId,
    departmentId: data?.departmentId ?? undefined,
    status: data?.status,
    gender: profile?.gender ?? undefined,
    birthday: profile?.birthday ?? undefined,
    idCard: profile?.idCard ?? undefined,
    education: profile?.education ?? undefined,
    entryDate: profile?.entryDate ?? undefined,
    province: profile?.province ?? undefined,
    city: profile?.city ?? undefined,
    district: profile?.district ?? undefined,
    addressDetail: profile?.addressDetail ?? undefined,
    position: profile?.position ?? undefined,
    jobLevel: profile?.jobLevel ?? undefined,
    employmentType: profile?.employmentType ?? undefined,
    probationEndDate: profile?.probationEndDate ?? undefined,
    formalDate: profile?.formalDate ?? undefined,
    resignationDate: profile?.resignationDate ?? undefined,
    contractType: profile?.contractType ?? undefined,
    contractStartDate: profile?.contractStartDate ?? undefined,
    contractEndDate: profile?.contractEndDate ?? undefined,
    salary: profile?.salary ?? undefined,
    bankAccount: profile?.bankAccount ?? undefined,
    bankName: profile?.bankName ?? undefined,
    socialSecurityAccount: profile?.socialSecurityAccount ?? undefined,
    providentFundAccount: profile?.providentFundAccount ?? undefined,
    // PR3:workExperience/educationHistory/certificates 已迁到子表,不再出现在主 DTO
    // PR4 的 edit-profile 页会用 FullEmployeeProfileDto 接管档案编辑
    avatarAttachmentId: profile?.avatarAttachmentId ?? undefined,
    remark: profile?.remark ?? undefined
  };

  useEffect(() => {
    if (initialTab === "profile") {
      const el = document.getElementById("profile-basic");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [initialTab]);

  if (isLoading || !data || profileLoading) {
    return (
      <Page compact>
        <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑用户" />
        <FormPageSkeleton />
      </Page>
    );
  }

  return (
    <Page compact>
      <PageHeader
        back={() => router.push(`/admin/users/${id}`)}
        title={`编辑 ${data.name}`}
        subtitle={`工号 ${data.employeeNo} 不可改；不能改/禁自己（后端护栏）`}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={19}>
          <ProForm
            layout="vertical"
            initialValues={initialValues}
            submitter={{
              searchConfig: { resetText: "重置", submitText: "保存" },
              resetButtonProps: { style: { display: "none" } },
              submitButtonProps: { size: "large" }
            }}
            onFinish={async (values) => {
              const userPayload: Record<string, unknown> = {};
              const profilePayload: Record<string, unknown> = {};
              const userKeys = ["name", "email", "phone", "roleId", "departmentId", "status"] as const;
              for (const key of userKeys) {
                if (values[key] !== undefined) userPayload[key] = values[key];
              }
              const profileKeys = [
                "gender", "birthday", "idCard", "education", "entryDate", "address",
                "emergencyContactName", "emergencyContactPhone", "position", "jobLevel",
                "employmentType", "probationEndDate", "formalDate", "resignationDate",
                "contractType", "contractStartDate", "contractEndDate", "salary",
                "bankAccount", "bankName", "socialSecurityAccount", "providentFundAccount",
                "workExperience", "educationHistory", "certificates", "remark"
              ] as const;
              for (const key of profileKeys) {
                if (values[key] !== undefined) profilePayload[key] = values[key];
              }

              const res = await fetch(`/api/users/${id}/with-profile`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  user: userPayload,
                  profile: profilePayload,
                  attachmentIds: attachmentItems.map((a) => a.id)
                })
              });
              const json = await res.json();
              if (json.code !== 0) {
                message.error(json.message);
                return false;
              }

              message.success("已保存");
              router.push(`/admin/users/${id}`);
              return true;
            }}
          >
            <ProCard id="account" title="账号信息" style={{ marginBottom: 16 }}>
              <FormGrid columns={2}>
                <ProFormText
                  name="name"
                  label="姓名"
                  rules={[{ required: true, max: 40 }]}
                  fieldProps={{ size: "large", maxLength: 40 }}
                />
                <ProFormText
                  name="email"
                  label="邮箱"
                  rules={[{ required: true, type: "email", max: 120 }]}
                  fieldProps={{ size: "large", maxLength: 120 }}
                />
                <ProFormText
                  name="phone"
                  label="手机号"
                  fieldProps={{ size: "large", maxLength: 20 }}
                />
              </FormGrid>
            </ProCard>

            <ProCard id="role" title="角色与部门" style={{ marginBottom: 16 }}>
              <FormGrid columns={2}>
                <ProFormSelect
                  name="roleId"
                  label="角色"
                  options={roleOptions}
                  showSearch
                  rules={[{ required: true }]}
                  fieldProps={{ size: "large", optionFilterProp: "label" }}
                />
                <DepartmentTreeSelect label="部门" />
              </FormGrid>
            </ProCard>

            <ProCard id="status" title="账号状态" style={{ marginBottom: 16 }}>
              <FormGrid columns={1}>
                <ProFormSelect
                  name="status"
                  label="账号状态"
                  options={[
                    { value: "ACTIVE", label: "启用" },
                    { value: "DISABLED", label: "禁用" }
                  ]}
                  rules={[{ required: true }]}
                  fieldProps={{ size: "large" }}
                />
                <Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    最后一位 <Tag color="blue">管理员</Tag> 不可禁用；自己不可改/禁（后端护栏）
                  </Text>
                </Space>
              </FormGrid>
            </ProCard>

            {isAdmin && (
              <>
                <ProCard id="profile-basic" title="员工档案 — 基础信息" style={{ marginBottom: 16 }}>
                  <FormGrid columns={2}>
                    <ProFormSelect
                      name="gender"
                      label="性别"
                      options={GENDER_OPTIONS}
                      allowClear
                      fieldProps={{ size: "large" }}
                    />
                    <ProFormDatePicker
                      name="birthday"
                      label="生日"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormSelect
                      name="education"
                      label="学历"
                      options={educationOptions}
                      allowClear
                      fieldProps={{ size: "large", showSearch: true, optionFilterProp: "label" }}
                    />
                    <ProFormDatePicker
                      name="entryDate"
                      label="入职日期"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormText
                      name="emergencyContactName"
                      label="紧急联系人"
                      fieldProps={{ size: "large", maxLength: 40 }}
                    />
                    <ProFormText
                      name="emergencyContactPhone"
                      label="紧急联系电话"
                      fieldProps={{ size: "large", maxLength: 20 }}
                    />
                    <ProFormText
                      name="address"
                      label="住址"
                      fieldProps={{ size: "large", maxLength: 200 }}
                    />
                  </FormGrid>
                </ProCard>

                <ProCard id="profile-position" title="员工档案 — 岗位与合同" style={{ marginBottom: 16 }}>
                  <FormGrid columns={2}>
                    <ProFormText
                      name="position"
                      label="岗位"
                      fieldProps={{ size: "large", maxLength: 50 }}
                    />
                    <ProFormText
                      name="jobLevel"
                      label="职级"
                      fieldProps={{ size: "large", maxLength: 50 }}
                    />
                    <ProFormSelect
                      name="employmentType"
                      label="用工类型"
                      options={EMPLOYMENT_TYPE_OPTIONS}
                      allowClear
                      fieldProps={{ size: "large" }}
                    />
                    <ProFormDatePicker
                      name="probationEndDate"
                      label="试用期结束日"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormDatePicker
                      name="formalDate"
                      label="转正日期"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormDatePicker
                      name="resignationDate"
                      label="离职日期"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormSelect
                      name="contractType"
                      label="合同类型"
                      options={contractTypeOptions}
                      allowClear
                      fieldProps={{ size: "large", showSearch: true, optionFilterProp: "label" }}
                    />
                    <ProFormDatePicker
                      name="contractStartDate"
                      label="合同开始日"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                    <ProFormDatePicker
                      name="contractEndDate"
                      label="合同结束日"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                  </FormGrid>
                </ProCard>

                <ProCard id="profile-sensitive" title="员工档案 — 敏感信息" style={{ marginBottom: 16 }}>
                  <Alert
                    message="以下信息将加密存储，仅管理员可查看"
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <FormGrid columns={2}>
                    <ProFormText
                      name="idCard"
                      label="身份证号"
                      fieldProps={{ size: "large", maxLength: 18 }}
                    />
                    <ProFormDigit
                      name="salary"
                      label="薪资"
                      min={0}
                      precision={2}
                      fieldProps={{ size: "large", style: { width: "100%" }, prefix: "¥" }}
                    />
                    <ProFormText
                      name="bankAccount"
                      label="银行卡号"
                      fieldProps={{ size: "large", maxLength: 40 }}
                    />
                    <ProFormText
                      name="bankName"
                      label="开户行"
                      fieldProps={{ size: "large", maxLength: 100 }}
                    />
                    <ProFormText
                      name="socialSecurityAccount"
                      label="社保账号"
                      fieldProps={{ size: "large", maxLength: 40 }}
                    />
                    <ProFormText
                      name="providentFundAccount"
                      label="公积金账号"
                      fieldProps={{ size: "large", maxLength: 40 }}
                    />
                  </FormGrid>
                </ProCard>

                <ProCard id="profile-remark" title="员工档案 — 履历与备注">
                  <FormGrid columns={1}>
                    <ProFormTextArea
                      name="workExperience"
                      label="工作经历"
                      fieldProps={{ rows: 4, maxLength: 5000, showCount: true }}
                    />
                    <ProFormTextArea
                      name="educationHistory"
                      label="教育经历"
                      fieldProps={{ rows: 4, maxLength: 5000, showCount: true }}
                    />
                    <ProFormTextArea
                      name="certificates"
                      label="证书"
                      fieldProps={{ rows: 4, maxLength: 5000, showCount: true }}
                    />
                    <ProFormTextArea
                      name="remark"
                      label="备注"
                      fieldProps={{ rows: 4, maxLength: 5000, showCount: true }}
                    />
                  </FormGrid>

                  <div style={{ marginTop: 16 }}>
                    <Text strong>附件</Text>
                    <div style={{ marginTop: 8 }}>
                      <Upload.Dragger
                        multiple
                        disabled={uploading}
                        showUploadList={false}
                        customRequest={async ({ file, onSuccess, onError }) => {
                          try {
                            setUploading(true);
                            const attachment = await uploadFileToMinIO(file as File, {
                              employeeProfileId: id
                            });
                            setAttachmentItems((prev) => [
                              ...prev,
                              {
                                id: attachment.id,
                                name: attachment.name,
                                mimeType: attachment.mimeType,
                                size: attachment.size
                              }
                            ]);
                            message.success(`${attachment.name} 上传成功`);
                            onSuccess?.(attachment);
                          } catch (err) {
                            message.error(err instanceof Error ? err.message : "上传失败");
                            onError?.(err as Error);
                          } finally {
                            setUploading(false);
                          }
                        }}
                      >
                        <p className="ant-upload-drag-icon">
                          <InboxOutlined />
                        </p>
                        <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                        <p className="ant-upload-hint">支持多个文件，单文件最大 50MB。</p>
                      </Upload.Dragger>
                    </div>

                    {attachmentItems.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <AttachmentList
                          items={attachmentItems}
                          onDeleted={(attachmentId) => {
                            setAttachmentItems((prev) => prev.filter((a) => a.id !== attachmentId));
                          }}
                          allowDelete={isAdmin}
                        />
                      </div>
                    )}
                  </div>
                </ProCard>
              </>
            )}
          </ProForm>
        </Col>

        <Col xs={0} lg={5}>
          <AnchorNav items={ANCHOR_ITEMS} offsetTop={90} />
        </Col>
      </Row>
    </Page>
  );
}
