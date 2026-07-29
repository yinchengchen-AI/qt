"use client";
import { StepsForm, ProFormText, ProFormSelect, ProFormDatePicker, ProFormDigit, ProFormTextArea, ProFormUploadButton, ProCard } from "@ant-design/pro-components";
import { App as AntdApp, Button, Form, Alert, Space, Tag, Typography } from "antd";
import { UserOutlined, IdcardOutlined, BankOutlined, BookOutlined, FileProtectOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProvinceCityDistrict } from "./province-city-district";
import { SubtableEditor } from "./subtable-editor";
import { useDict } from "@/lib/dict-client";
import { uploadFileToMinIO } from "@/lib/upload-client";
import { FormSection, FormGrid } from "@/components/form";
import { toIsoDateTime } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";
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
  const { isMobile } = useResponsive();
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
    profile: {
      ...(initial?.profile ?? {}),
      // 已有头像回显为 upload 列表项,删除该列表项即表示清除头像
      avatarUpload: initial?.avatar
        ? [{ uid: String(initial.avatar.id), name: initial.avatar.name || "当前头像", status: "done", url: initial.avatar.url, response: { id: String(initial.avatar.id) } }]
        : []
    },
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

  const [savingStep, setSavingStep] = useState<number | null>(null);
  // 乐观锁基线:每次保存成功后用响应里的最新 updatedAt 更新
  const baselineRef = useRef<string | undefined>(initial?.profile.updatedAt);

  // 每一步对应的保存切片:profile 只发本步字段,子表只发本步数组(后端缺省 = 不动)
  const STEP_SLICES: { profile: string[]; tables: ("emergencyContacts" | "workExperiences" | "educations" | "skills" | "certificates")[] }[] = [
    { profile: ["gender", "birthday", "idCard", "education", "entryDate", "province", "city", "district", "addressDetail", "avatarAttachmentId"], tables: ["emergencyContacts"] },
    { profile: ["position", "jobLevel", "employmentType", "probationEndDate", "formalDate", "resignationDate", "contractType", "contractStartDate", "contractEndDate"], tables: [] },
    ...(isAdmin ? [{ profile: ["salary", "bankAccount", "bankName", "socialSecurityAccount", "providentFundAccount"], tables: [] as ("emergencyContacts" | "workExperiences" | "educations" | "skills" | "certificates")[] }] : []),
    { profile: ["remark"], tables: ["workExperiences", "educations", "skills"] },
    { profile: [], tables: ["certificates"] }
  ];

  /** 表单原始值 → 规范化全量 body(头像/证书附件映射 + 日期转 ISO) */
  function normalizeValues(values: Record<string, unknown>) {
    const profile = { ...((values.profile as Record<string, unknown> | undefined) ?? {}) };

    // zod 的 optionalString/optionalDate 不接受 null,统一剔除(放弃"清空"语义,与后端现状一致):
    // - getFieldsValue(true) 会带出服务端 profile 的 null 初值(如 probationEndDate)
    // - 直辖市两级级联时 handleAddressChange 会写入 district: null
    // 注意 avatarAttachmentId=null 是显式清空头像,在下方头像逻辑里单独设置,不受此影响
    for (const k of Object.keys(profile)) {
      if (profile[k] === null) delete profile[k];
    }

    // 把 avatar 上传后写入 profile.avatarAttachmentId
    const avatarList = profile.avatarUpload as Array<{ id?: string }> | undefined;
    if (Array.isArray(avatarList) && avatarList[0]?.id) {
      profile.avatarAttachmentId = avatarList[0].id;
    } else if (Array.isArray(avatarList) && avatarList.length === 0 && initial?.avatar) {
      // 用户删除了已有头像 → 显式清空(后端 validator 接受 null)
      profile.avatarAttachmentId = null;
    }
    delete profile.avatarUpload;

    // 把证书附件 upload 转换为 attachmentId(保留已有未上传的)
    const certs = ((values.certificates as Array<Record<string, unknown>> | undefined) ?? []).map((c) => ({ ...c }));
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

    return {
      profile,
      educations: (values.educations as unknown[] | undefined) ?? [],
      workExperiences: (values.workExperiences as unknown[] | undefined) ?? [],
      certificates: certs,
      skills: (values.skills as unknown[] | undefined) ?? [],
      emergencyContacts: (values.emergencyContacts as unknown[] | undefined) ?? []
    };
  }

  /** 统一提交:带乐观锁基线,409 时弹覆盖确认;成功后刷新基线 */
  async function submitBody(body: Record<string, unknown>, opts: { successText: string; navigate?: boolean }): Promise<boolean> {
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
            baselineRef.current = j2.data?.profile?.updatedAt ?? baselineRef.current;
            message.success("已覆盖保存");
            if (opts.navigate) router.push(`/admin/users/${userId}`);
          }
        });
        return false;
      }
      message.error(j.message);
      return false;
    }
    baselineRef.current = j.data?.profile?.updatedAt ?? baselineRef.current;
    message.success(opts.successText);
    if (opts.navigate) router.push(`/admin/users/${userId}`);
    return true;
  }

  /** 最后一步统一提交:全量 body + 保存后返回详情页 */
  async function handleFinish(values: Record<string, unknown>) {
    try {
      const body = { ...normalizeValues(values), expectedUpdatedAt: baselineRef.current };
      await submitBody(body, { successText: "档案已保存", navigate: true });
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 每步独立保存:只校验并提交当前步的切片,停留在当前页 */
  async function saveStep(step: number, form: { validateFields: () => Promise<unknown>; getFieldsValue: (all: boolean) => Record<string, unknown> } | undefined) {
    if (!form) return;
    const slice = STEP_SLICES[step];
    if (!slice) return;
    try {
      await form.validateFields();
    } catch {
      return; // 校验失败,antd 已在字段上提示
    }
    try {
      const full = normalizeValues(form.getFieldsValue(true));
      const profile: Record<string, unknown> = {};
      for (const k of slice.profile) {
        if (full.profile[k] !== undefined) profile[k] = full.profile[k];
      }
      const body: Record<string, unknown> = { expectedUpdatedAt: baselineRef.current };
      if (Object.keys(profile).length > 0) body.profile = profile;
      for (const t of slice.tables) body[t] = full[t];
      setSavingStep(step);
      await submitBody(body, { successText: "本步已保存" });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSavingStep(null);
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
            按以下 5 步填写完整档案;每步可点「保存本步」单独保存,也可在最后一步「提交」统一保存。
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
        submitter={{
          render: (props, doms) => {
            const step = (props.step as number | undefined) ?? 0;
            // 默认按钮([上一步] 下一步/提交)保持不动,"保存本步"插到主按钮前。
            // 注:此处依赖 StepsForm 当前 buttons 构成(最后一个元素必为主按钮),
            // pro-components 升级后若按钮构成变化需同步调整。
            const saveBtn = (
              <Button
                key="save-step"
                loading={savingStep === step}
                onClick={() => void saveStep(step, props.form)}
              >
                保存本步
              </Button>
            );
            return [...doms.slice(0, -1), saveBtn, doms[doms.length - 1]];
          }
        }}
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
            <div className="profile-wizard-hero" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(160px, 200px) 1fr", gap: 24, alignItems: "flex-start" }}>
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
                <ProFormText
                  name={["profile", "idCard"]}
                  label="身份证号"
                  width="md"
                  rules={[{ pattern: /^[0-9]{17}[0-9Xx]$/, message: "身份证号格式不正确(18 位)" }]}
                />
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
                <AddressCascader onChange={handleAddressChange} />
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
                { name: "phone", label: "电话", valueType: "text", required: true, pattern: { regex: /^1[3-9][0-9]{9}$|^0[0-9]{2,3}-?[0-9]{7,8}$/, message: "电话格式不正确" } },
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
                <ProFormText
                  name={["profile", "bankAccount"]}
                  label="银行卡号"
                  width="md"
                  rules={[{ pattern: /^[0-9]{8,19}$/, message: "银行卡号应为 8~19 位数字" }]}
                />
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

/** 省市区级联:从表单 store 取当前值回显,保证切换步骤/重新选择后显示始终正确 */
function AddressCascader({ onChange }: { onChange: (v: { province?: string; city?: string; district?: string }) => void }) {
  const province = Form.useWatch(["profile", "province"]);
  const city = Form.useWatch(["profile", "city"]);
  const district = Form.useWatch(["profile", "district"]);
  return (
    <ProvinceCityDistrict
      value={{
        province: (province as string | null | undefined) ?? undefined,
        city: (city as string | null | undefined) ?? undefined,
        district: (district as string | null | undefined) ?? undefined
      }}
      onChange={onChange}
    />
  );
}
