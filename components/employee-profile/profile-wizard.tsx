"use client";
import { StepsForm, ProFormText, ProFormSelect, ProFormDatePicker, ProFormDigit, ProFormTextArea, ProFormUploadButton, ProCard } from "@ant-design/pro-components";
import { App as AntdApp, Form, Alert, Space, Tag, Typography } from "antd";
import { UserOutlined, IdcardOutlined, BankOutlined, BookOutlined, FileProtectOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { ProvinceCityDistrict } from "./province-city-district";
import { SubtableEditor } from "./subtable-editor";
import { useDict } from "@/lib/dict-client";
import { uploadFileToMinIO } from "@/lib/upload-client";
import { FormSection, FormGrid } from "@/components/form";
import { toIsoDateTime } from "@/lib/format";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

const { Text, Title } = Typography;

const GENDER = [
  { value: "MALE", label: "男" },
  { value: "FEMALE", label: "女" },
  { value: "OTHER", label: "其他" }
];

const EMPLOYMENT_TYPE = [
  { value: "FULL_TIME", label: "全职" },
  { value: "PART_TIME", label: "兼职" },
  { value: "INTERN", label: "实习" },
  { value: "CONTRACTOR", label: "外包" }
];

const RELATIONSHIPS = [
  { value: "父母", label: "父母" },
  { value: "配偶", label: "配偶" },
  { value: "兄弟姐妹", label: "兄弟姐妹" },
  { value: "子女", label: "子女" },
  { value: "其他", label: "其他" }
];

const SKILL_LEVEL = [
  { value: "BEGINNER", label: "初级" },
  { value: "INTERMEDIATE", label: "中级" },
  { value: "ADVANCED", label: "高级" }
];

type Props = {
  userId: string;
  initial: FullEmployeeProfileDto | null;
  isAdmin: boolean;
};

const STEPS = [
  { title: "基础", icon: <UserOutlined />, summary: "头像、性别、身份证、地址、紧急联系人" },
  { title: "岗位合同", icon: <IdcardOutlined />, summary: "岗位、职级、用工类型、合同起止" },
  { title: "敏感", icon: <BankOutlined />, summary: "薪资、银行卡、社保/公积金账号(仅管理员)" },
  { title: "履历", icon: <BookOutlined />, summary: "工作经历、教育经历、技能" },
  { title: "证书与附件", icon: <FileProtectOutlined />, summary: "职业证书、扫描件" }
];

export function ProfileWizard({ userId, initial, isAdmin }: Props) {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const formRef = useRef<unknown>(null);
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  function handleAddressChange(v: { province?: string; city?: string; district?: string }) {
    // 通过 formRef 写入,避免 document.activeElement 黑魔法
    const f = formRef.current as { setFieldsValue?: (v: Record<string, unknown>) => void } | null;
    if (!f?.setFieldsValue) return;
    f.setFieldsValue({
      profile: {
        ...(v.province ? { province: v.province } : { province: null }),
        ...(v.city ? { city: v.city } : { city: null }),
        ...(v.district ? { district: v.district } : { district: null })
      }
    });
  }

  const initialValues = {
    profile: initial?.profile ?? {},
    educations: initial?.educations ?? [],
    workExperiences: initial?.workExperiences ?? [],
    certificates: (initial?.certificates ?? []).map((c) => {
      const cert = c as Record<string, unknown>;
      return {
        ...cert,
        attachmentUpload: cert.attachmentId
          ? [{ uid: String(cert.attachmentId), name: "已上传证书", status: "done", url: `/api/files/raw/${String(cert.attachmentId)}`, response: { id: String(cert.attachmentId) } }]
          : []
      };
    }),
    skills: initial?.skills ?? [],
    emergencyContacts: initial?.emergencyContacts ?? []
  };

  async function handleFinish(values: Record<string, unknown>) {
    try {
      // 把 avatar 上传后写入 profile.avatarAttachmentId
      const avatarList = values.profile && (values.profile as Record<string, unknown>).avatarUpload as Array<{ id?: string }> | undefined;
      if (Array.isArray(avatarList) && avatarList[0]?.id) {
        (values.profile as Record<string, unknown>).avatarAttachmentId = avatarList[0].id;
      }
      delete (values.profile as Record<string, unknown>)?.avatarUpload;

      // 把证书附件 upload 转换为 attachmentId(保留已有未上传的)
      const certs = (values.certificates as Array<Record<string, unknown>> | undefined) ?? [];
      for (const c of certs) {
        const uploadList = c.attachmentUpload as Array<{ response?: { id?: string }; id?: string }> | undefined;
        if (Array.isArray(uploadList) && uploadList.length > 0) {
          const item = uploadList[0];
          const id = item?.response?.id ?? item?.id;
          if (id) {
            c.attachmentId = id;
          }
        }
        delete c.attachmentUpload;
      }

      // 日期字段(来自 ProFormDatePicker 的 dayjs 对象)统一转 ISO 字符串
      const profile = values.profile as Record<string, unknown> | undefined;
      if (profile) {
        for (const key of [
          "birthday",
          "entryDate",
          "probationEndDate",
          "formalDate",
          "resignationDate",
          "contractStartDate",
          "contractEndDate"
        ]) {
          const iso = toIsoDateTime(profile[key]);
          if (iso !== undefined) profile[key] = iso;
          else if (profile[key] === undefined || profile[key] === "") delete profile[key];
        }
      }

      const body = {
        ...values,
        expectedUpdatedAt: initial?.profile.updatedAt
      };

      const r = await fetch(`/api/users/${userId}/with-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code !== 0) {
        if (j.errorCode === "CONFLICT" || j.code === 409) {
          modal.confirm({
            title: "档案已被他人修改",
            content: "是否覆盖?(覆盖会丢失他人的修改)",
            okText: "覆盖保存",
            cancelText: "取消",
            onOk: async () => {
              const r2 = await fetch(`/api/users/${userId}/with-profile`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ ...body, expectedUpdatedAt: undefined })
              });
              const j2 = await r2.json();
              if (j2.code !== 0) return message.error(j2.message);
              message.success("已覆盖保存");
              router.push(`/admin/users/${userId}`);
            }
          });
          return;
        }
        message.error(j.message);
        return;
      }
      message.success("档案已保存");
      router.push(`/admin/users/${userId}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  return (
    <>
      <ProCard
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: "16px 20px" } }}
      >
        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Title level={4} style={{ margin: 0 }}>员工档案向导</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            按以下 5 步填写完整档案,可随时点击步骤标题返回修改;每步可单独保存。
          </Text>
        </Space>
        <Space size={6} wrap style={{ marginTop: 12 }}>
          {STEPS.map((s, i) => (
            <Tag
              key={s.title}
              icon={s.icon}
              color="blue"
              style={{ padding: "4px 10px", borderRadius: 999, margin: 0 }}
            >
              {i + 1}. {s.title}
            </Tag>
          ))}
        </Space>
      </ProCard>

      <StepsForm
        formRef={formRef as never}
        onFinish={handleFinish}
        stepsFormRender={(dom, submitter) => (
          <ProCard>
            {dom}
            {submitter}
          </ProCard>
        )}
      >
        {/* Step 1: 基础 */}
        <StepsForm.StepForm
          title="基础"
          initialValues={initialValues}
        >
          <FormSection
            title="个人信息"
            description="头像 / 性别 / 生日 / 身份证 / 学历 / 入职"
            icon={<UserOutlined />}
          >
            <div className="profile-wizard-hero" style={{ display: "grid", gridTemplateColumns: "minmax(160px, 200px) 1fr", gap: 24, alignItems: "flex-start" }}>
              <div>
                <ProFormUploadButton
                  name={["profile", "avatarUpload"]}
                  label="头像"
                  max={1}
                  fieldProps={{
                    name: "file",
                    listType: "picture",
                    customRequest: async (options) => {
                      const att = await uploadFileToMinIO(options.file as File, { category: "AVATAR" });
                      options.onSuccess?.(att, new XMLHttpRequest());
                    }
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  支持 JPG/PNG,建议 1:1,最大 5MB
                </Text>
              </div>
              <FormGrid columns={2}>
                <ProFormSelect name={["profile", "gender"]} label="性别" options={GENDER} width="md" />
                <ProFormDatePicker name={["profile", "birthday"]} label="生日" width="md" />
                <ProFormText name={["profile", "idCard"]} label="身份证号" width="md" />
                <ProFormSelect
                  name={["profile", "education"]}
                  label="最高学历"
                  options={educationDict.map((d) => ({ value: d.code, label: d.label }))}
                  width="md"
                  allowClear
                />
                <ProFormDatePicker name={["profile", "entryDate"]} label="入职日期" width="md" />
              </FormGrid>
            </div>
          </FormSection>

          <FormSection
            title="住址"
            description="结构化 + 详细地址,优先按省/市/区"
            icon={<IdcardOutlined />}
          >
            <FormGrid columns={2}>
              <Form.Item label="省/市/区">
                <ProvinceCityDistrict
                  value={{
                    province: initial?.profile.province ?? undefined,
                    city: initial?.profile.city ?? undefined,
                    district: initial?.profile.district ?? undefined
                  }}
                  onChange={handleAddressChange}
                />
              </Form.Item>
              <ProFormText name={["profile", "addressDetail"]} label="详细地址" width="md" />
            </FormGrid>
          </FormSection>

          <FormSection
            title="紧急联系人"
            description="至少 1 位,出险时优先联系"
            icon={<UserOutlined />}
            gap={0}
          >
            <SubtableEditor
              name="emergencyContacts"
              label="紧急联系人"
              initialValue={initialValues.emergencyContacts as Record<string, unknown>[]}
              fields={[
                { name: "name", label: "姓名", valueType: "text", required: true },
                { name: "relationship", label: "关系", valueType: "select", options: RELATIONSHIPS, required: true },
                { name: "phone", label: "电话", valueType: "text", required: true },
                { name: "remark", label: "备注", valueType: "textarea" }
              ]}
            />
          </FormSection>
        </StepsForm.StepForm>

        {/* Step 2: 岗位合同 */}
        <StepsForm.StepForm title="岗位合同" initialValues={initialValues}>
          <FormSection title="岗位信息" icon={<IdcardOutlined />}>
            <FormGrid columns={2}>
              <ProFormText name={["profile", "position"]} label="岗位" width="md" />
              <ProFormText name={["profile", "jobLevel"]} label="职级" width="md" />
              <ProFormSelect name={["profile", "employmentType"]} label="用工类型" options={EMPLOYMENT_TYPE} width="md" />
              <ProFormDatePicker name={["profile", "probationEndDate"]} label="试用期结束" width="md" />
              <ProFormDatePicker name={["profile", "formalDate"]} label="转正日期" width="md" />
              <ProFormDatePicker name={["profile", "resignationDate"]} label="离职日期" width="md" />
            </FormGrid>
          </FormSection>

          <FormSection title="合同信息" description="类型与起止" icon={<FileProtectOutlined />} gap={0}>
            <FormGrid columns={2}>
              <ProFormSelect
                name={["profile", "contractType"]}
                label="合同类型"
                options={contractTypeDict.map((d) => ({ value: d.code, label: d.label }))}
                width="md"
                allowClear
              />
              <div /> {/* 占位,让日期单独一行更整齐 */}
              <ProFormDatePicker name={["profile", "contractStartDate"]} label="合同开始" width="md" />
              <ProFormDatePicker name={["profile", "contractEndDate"]} label="合同结束" width="md" />
            </FormGrid>
          </FormSection>
        </StepsForm.StepForm>

        {/* Step 3: 敏感(仅 ADMIN) */}
        {isAdmin && (
          <StepsForm.StepForm title="敏感" initialValues={initialValues}>
            <Alert
              message="本页仅管理员可见,所有字段视为敏感"
              description="保存后会写入审计日志;切勿在公共环境打开此页。"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <FormSection title="薪资" icon={<BankOutlined />}>
              <ProFormDigit name={["profile", "salary"]} label="月薪(税前)" min={0} width="sm" fieldProps={{ prefix: "¥" }} />
            </FormSection>
            <FormSection title="银行与账户" icon={<BankOutlined />} gap={0}>
              <FormGrid columns={2}>
                <ProFormText name={["profile", "bankAccount"]} label="银行卡号" width="md" />
                <ProFormText name={["profile", "bankName"]} label="开户行" width="md" />
                <ProFormText name={["profile", "socialSecurityAccount"]} label="社保账号" width="md" />
                <ProFormText name={["profile", "providentFundAccount"]} label="公积金账号" width="md" />
              </FormGrid>
            </FormSection>
          </StepsForm.StepForm>
        )}

        {/* Step 4: 履历 */}
        <StepsForm.StepForm title="履历" initialValues={initialValues}>
          <FormSection title="工作经历" icon={<BookOutlined />}>
            <SubtableEditor
              name="workExperiences"
              label="工作经历"
              initialValue={initialValues.workExperiences as Record<string, unknown>[]}
              fields={[
                { name: "company", label: "公司", valueType: "text", required: true },
                { name: "position", label: "岗位", valueType: "text" },
                { name: "startDate", label: "起始", valueType: "date", required: true },
                { name: "endDate", label: "结束", valueType: "date" },
                { name: "leaveReason", label: "离职原因", valueType: "text" },
                { name: "referrer", label: "证明人", valueType: "text" },
                { name: "remark", label: "备注", valueType: "textarea" }
              ]}
            />
          </FormSection>

          <FormSection title="教育经历" icon={<BookOutlined />}>
            <SubtableEditor
              name="educations"
              label="教育经历"
              initialValue={initialValues.educations as Record<string, unknown>[]}
              fields={[
                { name: "school", label: "学校", valueType: "text", required: true },
                { name: "major", label: "专业", valueType: "text" },
                { name: "degree", label: "学历", valueType: "select", options: educationDict.map((d) => ({ value: d.code, label: d.label })) },
                { name: "startDate", label: "入学", valueType: "date", required: true },
                { name: "endDate", label: "毕业", valueType: "date" },
                { name: "isFullTime", label: "全日制", valueType: "switch" },
                { name: "remark", label: "备注", valueType: "textarea" }
              ]}
            />
          </FormSection>

          <FormSection title="技能" icon={<BookOutlined />}>
            <SubtableEditor
              name="skills"
              label="技能"
              initialValue={initialValues.skills as Record<string, unknown>[]}
              fields={[
                { name: "name", label: "技能名", valueType: "text", required: true },
                { name: "level", label: "熟练度", valueType: "select", options: SKILL_LEVEL },
                { name: "obtainDate", label: "取得日期", valueType: "date" },
                { name: "remark", label: "备注", valueType: "textarea" }
              ]}
            />
          </FormSection>

          <FormSection title="整体备注" icon={<BookOutlined />} gap={0}>
            <ProFormTextArea
              name={["profile", "remark"]}
              label="备注"
              fieldProps={{ maxLength: 5000, showCount: true, autoSize: { minRows: 3, maxRows: 8 } }}
            />
          </FormSection>
        </StepsForm.StepForm>

        {/* Step 5: 证书与附件 */}
        <StepsForm.StepForm title="证书与附件" initialValues={initialValues}>
          <FormSection title="证书" description="可上传对应扫描件" icon={<FileProtectOutlined />}>
            <SubtableEditor
              name="certificates"
              label="证书"
              initialValue={initialValues.certificates as Record<string, unknown>[]}
              fields={[
                { name: "name", label: "证书名", valueType: "text", required: true },
                { name: "number", label: "编号", valueType: "text" },
                { name: "issuer", label: "颁发机构", valueType: "text" },
                { name: "issueDate", label: "颁发日", valueType: "date" },
                { name: "expiryDate", label: "到期日", valueType: "date" },
                { name: "attachmentUpload", label: "证书扫描件", valueType: "upload", uploadCategory: "CERTIFICATE" },
                { name: "remark", label: "备注", valueType: "textarea" }
              ]}
            />
          </FormSection>
          <Alert
            message="证书附件上传"
            description="每个证书可上传对应扫描件(PDF/图片),保存后自动关联到该证书。"
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        </StepsForm.StepForm>
      </StepsForm>
    </>
  );
}
