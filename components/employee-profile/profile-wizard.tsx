"use client";
import { StepsForm, ProFormText, ProFormSelect, ProFormDatePicker, ProFormDigit, ProFormTextArea, ProFormUploadButton, ProCard } from "@ant-design/pro-components";
import { App as AntdApp, Form, Alert } from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProvinceCityDistrict } from "./province-city-district";
import { SubtableEditor } from "./subtable-editor";
import { useDict } from "@/lib/dict-client";
import { uploadFileToMinIO } from "@/lib/upload-client";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

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

export function ProfileWizard({ userId, initial, isAdmin }: Props) {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<unknown>(null);
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  function handleAddressChange(v: { province?: string; city?: string; district?: string }) {
    // 通过 document.activeElement 找 form 然后 setFieldsValue
    const f = formRef.current as { setFieldsValue?: (v: Record<string, unknown>) => void } | null;
    if (f?.setFieldsValue) {
      f.setFieldsValue({
        profile: { ...(v.province ? { province: v.province } : {}), ...(v.city ? { city: v.city } : {}), ...(v.district ? { district: v.district } : {}) }
      });
    }
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
    setSubmitting(true);
    try {
      // 把 avatar 上传后写入 profile.avatarAttachmentId
      const avatarList = values.profile && (values.profile as Record<string, unknown>).avatarUpload as Array<{ id?: string }> | undefined;
      if (Array.isArray(avatarList) && avatarList[0]?.id) {
        (values.profile as Record<string, unknown>).avatarAttachmentId = avatarList[0].id;
      }
      delete (values.profile as Record<string, unknown>)?.avatarUpload;

      // 把证书附件 upload 转换为 attachmentId（保留已有未上传的）
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
        <ProFormUploadButton
          name={["profile", "avatarUpload"]}
          label="头像"
          max={1}
          fieldProps={{
            name: "file",
            listType: "picture",
            customRequest: async (options) => {
              // P0-10: 传 category: "AVATAR" 落库分类
              const att = await uploadFileToMinIO(options.file as File, { category: "AVATAR" });
              // P0-9: antd Upload 期望 onSuccess(response, xhr),ProForm 通过
              // response.id 拿到上传后的 attachment id
              options.onSuccess?.(att, new XMLHttpRequest());
            }
          }}
        />
        <ProFormSelect name={["profile", "gender"]} label="性别" options={GENDER} width="sm" />
        <ProFormDatePicker name={["profile", "birthday"]} label="生日" width="sm" />
        <ProFormText name={["profile", "idCard"]} label="身份证号" width="md" />
        <ProFormSelect
          name={["profile", "education"]}
          label="最高学历"
          options={educationDict.map((d) => ({ value: d.code, label: d.label }))}
          width="sm"
          allowClear
        />
        <ProFormDatePicker name={["profile", "entryDate"]} label="入职日期" width="sm" />
        <Form.Item label="住址(省/市/区)">
          <ProvinceCityDistrict
            value={{
              province: initial?.profile.province ?? undefined,
              city: initial?.profile.city ?? undefined,
              district: initial?.profile.district ?? undefined
            }}
            onChange={handleAddressChange}
          />
        </Form.Item>
        <ProFormText name={["profile", "addressDetail"]} label="详细地址" width="lg" />
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
      </StepsForm.StepForm>

      {/* Step 2: 岗位合同 */}
      <StepsForm.StepForm title="岗位合同" initialValues={initialValues}>
        <ProFormText name={["profile", "position"]} label="岗位" width="sm" />
        <ProFormText name={["profile", "jobLevel"]} label="职级" width="sm" />
        <ProFormSelect name={["profile", "employmentType"]} label="用工类型" options={EMPLOYMENT_TYPE} width="sm" />
        <ProFormDatePicker name={["profile", "probationEndDate"]} label="试用期结束" width="sm" />
        <ProFormDatePicker name={["profile", "formalDate"]} label="转正日期" width="sm" />
        <ProFormDatePicker name={["profile", "resignationDate"]} label="离职日期" width="sm" />
        <ProFormSelect
          name={["profile", "contractType"]}
          label="合同类型"
          options={contractTypeDict.map((d) => ({ value: d.code, label: d.label }))}
          width="sm"
          allowClear
        />
        <ProFormDatePicker name={["profile", "contractStartDate"]} label="合同开始" width="sm" />
        <ProFormDatePicker name={["profile", "contractEndDate"]} label="合同结束" width="sm" />
      </StepsForm.StepForm>

      {/* Step 3: 敏感(仅 ADMIN) */}
      {isAdmin && (
        <StepsForm.StepForm title="敏感" initialValues={initialValues}>
          <Alert message="本页仅管理员可见,所有字段视为敏感" type="warning" showIcon style={{ marginBottom: 16 }} />
          <ProFormDigit name={["profile", "salary"]} label="薪资" min={0} width="sm" />
          <ProFormText name={["profile", "bankAccount"]} label="银行卡号" width="md" />
          <ProFormText name={["profile", "bankName"]} label="开户行" width="md" />
          <ProFormText name={["profile", "socialSecurityAccount"]} label="社保账号" width="md" />
          <ProFormText name={["profile", "providentFundAccount"]} label="公积金账号" width="md" />
        </StepsForm.StepForm>
      )}

      {/* Step 4: 履历 */}
      <StepsForm.StepForm title="履历" initialValues={initialValues}>
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
        <ProFormTextArea name={["profile", "remark"]} label="备注" fieldProps={{ maxLength: 5000, showCount: true }} />
      </StepsForm.StepForm>

      {/* Step 5: 证书与附件 */}
      <StepsForm.StepForm title="证书与附件" initialValues={initialValues}>
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
        <Alert
          message="证书附件上传"
          description="每个证书可上传对应扫描件(PDF/图片),保存后自动关联到该证书。"
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      </StepsForm.StepForm>
    </StepsForm>
  );
}
