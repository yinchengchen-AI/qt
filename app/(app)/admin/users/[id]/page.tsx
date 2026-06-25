"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { Tag, Button, Tabs, Empty, Space, Typography } from "antd";
import { EyeOutlined, EyeInvisibleOutlined, EditOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { DateCell, DateTimeCell } from "@/components/table-cells";
import { useDict } from "@/lib/dict-client";
import type { EmployeeProfileDto } from "@/lib/types/employee-profile";
import { AttachmentList } from "@/components/file/attachment-list";
import {
  formatGender,
  formatEmploymentType,
  formatDate,
  formatCurrency,
  maskIdCard,
  maskBankAccount,
  maskPhone
} from "@/lib/format";

const { Paragraph, Text } = Typography;

type User = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  role: { id: string; code: string; name: string };
  department: { id: string; code: string; name: string } | null;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function SectionTitle({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <Text strong style={{ fontSize: 15 }}>{title}</Text>
      {extra}
    </div>
  );
}

function LongText({ value }: { value: string | null }) {
  if (!value) return <Text type="secondary">—</Text>;
  return (
    <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {value}
    </Paragraph>
  );
}

function SensitiveField({
  value,
  maskFn,
  isAdmin
}: {
  value: string | null;
  maskFn: (v: string) => string;
  isAdmin: boolean;
}) {
  const [visible, setVisible] = useState(false);
  if (!value) return <Text type="secondary">—</Text>;
  if (!isAdmin) return <Text>{maskFn(value)}</Text>;
  return (
    <Space>
      <Text>{visible ? value : maskFn(value)}</Text>
      <Button
        type="text"
        size="small"
        icon={visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        onClick={() => setVisible((v) => !v)}
      />
    </Space>
  );
}

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  const { data, error, isLoading, mutate } = useSWR<User>(`/api/users/${id}`);
  const { data: profileResp, error: profileError } = useSWR<{ data: EmployeeProfileDto | null }>(
    `/api/users/${id}/profile`
  );

  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  if (error || profileError) {
    const err = error || profileError;
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <div style={{ marginTop: 12 }}>
          <ErrorBox
            title="加载失败"
            action={
              <Button size="small" onClick={() => mutate()}>
                重试
              </Button>
            }
          >
            {(err as Error).message}
          </ErrorBox>
        </div>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const profile = profileResp?.data ?? null;

  const educationLabel = (code: string | null) =>
    code ? (educationDict.find((d) => d.code === code)?.label ?? code) : "—";
  const contractTypeLabel = (code: string | null) =>
    code ? (contractTypeDict.find((d) => d.code === code)?.label ?? code) : "—";

  const accountTab = (
    <ProCard>
      <ProDescriptions<User>
        column={2}
        dataSource={data}
        columns={[
          { title: "工号", dataIndex: "employeeNo" },
          { title: "姓名", dataIndex: "name" },
          { title: "邮箱", dataIndex: "email" },
          {
            title: "手机",
            dataIndex: "phone",
            render: (_: unknown, r: User) => (r.phone ? maskPhone(r.phone) : "—")
          },
          {
            title: "角色",
            dataIndex: ["role", "name"],
            render: () => `${data.role?.name ?? "—"} (${data.role?.code ?? ""})`
          },
          { title: "部门", dataIndex: ["department", "name"], render: (_: unknown, r: User) => r.department?.name ?? "—" },
          {
            title: "状态",
            dataIndex: "status",
            render: (_: unknown, r: User) => (
              <Tag color={r.status === "ACTIVE" ? "green" : "default"}>
                {r.status === "ACTIVE" ? "启用" : "禁用"}
              </Tag>
            )
          },
          {
            title: "最近登录",
            dataIndex: "lastLoginAt",
            render: (_: unknown, r: User) => (r.lastLoginAt ? <DateTimeCell value={r.lastLoginAt} /> : "从未登录")
          },
          { title: "创建时间", dataIndex: "createdAt", render: (_: unknown, r: User) => <DateCell value={r.createdAt} /> },
          { title: "更新时间", dataIndex: "updatedAt", render: (_: unknown, r: User) => <DateCell value={r.updatedAt} /> }
        ]}
      />
    </ProCard>
  );

  const profileTab = profile ? (
    <>
      <ProCard style={{ marginBottom: 16 }}>
        <SectionTitle
          title="基础信息"
          extra={
            isAdmin && (
              <Button type="link" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit?tab=profile`)}>
                编辑档案
              </Button>
            )
          }
        />
        <ProDescriptions<EmployeeProfileDto>
          column={2}
          dataSource={profile}
          columns={[
            { title: "性别", dataIndex: "gender", render: (v) => formatGender(v as string | null) },
            { title: "生日", dataIndex: "birthday", render: (v) => formatDate(v as string | null) },
            { title: "学历", dataIndex: "education", render: (v) => educationLabel(v as string | null) },
            { title: "入职日期", dataIndex: "entryDate", render: (v) => formatDate(v as string | null) },
            { title: "紧急联系人", dataIndex: "emergencyContactName", render: (v) => (v ? String(v) : "—") },
            { title: "紧急联系电话", dataIndex: "emergencyContactPhone", render: (v) => maskPhone(v as string | null) },
            { title: "住址", dataIndex: "address", span: 2, render: (v) => <LongText value={v as string | null} /> }
          ]}
        />
      </ProCard>

      <ProCard style={{ marginBottom: 16 }}>
        <SectionTitle title="岗位与合同" />
        <ProDescriptions<EmployeeProfileDto>
          column={2}
          dataSource={profile}
          columns={[
            { title: "岗位", dataIndex: "position", render: (v) => (v ? String(v) : "—") },
            { title: "职级", dataIndex: "jobLevel", render: (v) => (v ? String(v) : "—") },
            { title: "用工类型", dataIndex: "employmentType", render: (v) => formatEmploymentType(v as string | null) },
            { title: "试用期结束日", dataIndex: "probationEndDate", render: (v) => formatDate(v as string | null) },
            { title: "转正日期", dataIndex: "formalDate", render: (v) => formatDate(v as string | null) },
            { title: "离职日期", dataIndex: "resignationDate", render: (v) => formatDate(v as string | null) },
            { title: "合同类型", dataIndex: "contractType", render: (v) => contractTypeLabel(v as string | null) },
            { title: "合同开始日", dataIndex: "contractStartDate", render: (v) => formatDate(v as string | null) },
            { title: "合同结束日", dataIndex: "contractEndDate", render: (v) => formatDate(v as string | null) }
          ]}
        />
      </ProCard>

      {isAdmin && (
        <ProCard style={{ marginBottom: 16 }}>
          <SectionTitle title="敏感信息" extra={<Tag color="red">仅管理员可见</Tag>} />
          <ProDescriptions<EmployeeProfileDto>
            column={2}
            dataSource={profile}
            columns={[
              {
                title: "身份证号",
                dataIndex: "idCard",
                render: (v) => <SensitiveField value={v as string | null} maskFn={maskIdCard} isAdmin={isAdmin} />
              },
              {
                title: "薪资",
                dataIndex: "salary",
                render: (v) => (v != null ? <Text strong>{formatCurrency(v as number)}</Text> : "—")
              },
              {
                title: "银行卡号",
                dataIndex: "bankAccount",
                render: (v) => <SensitiveField value={v as string | null} maskFn={maskBankAccount} isAdmin={isAdmin} />
              },
              { title: "开户行", dataIndex: "bankName", render: (v) => (v ? String(v) : "—") },
              {
                title: "社保账号",
                dataIndex: "socialSecurityAccount",
                render: (v) => <SensitiveField value={v as string | null} maskFn={maskBankAccount} isAdmin={isAdmin} />
              },
              {
                title: "公积金账号",
                dataIndex: "providentFundAccount",
                render: (v) => <SensitiveField value={v as string | null} maskFn={maskBankAccount} isAdmin={isAdmin} />
              }
            ]}
          />
        </ProCard>
      )}

      <ProCard style={{ marginBottom: 16 }}>
        <SectionTitle title="履历与备注" />
        <ProDescriptions<EmployeeProfileDto>
          column={1}
          dataSource={profile}
          columns={[
            { title: "工作经历", dataIndex: "workExperience", render: (v) => <LongText value={v as string | null} /> },
            { title: "教育经历", dataIndex: "educationHistory", render: (v) => <LongText value={v as string | null} /> },
            { title: "证书", dataIndex: "certificates", render: (v) => <LongText value={v as string | null} /> },
            { title: "备注", dataIndex: "remark", render: (v) => <LongText value={v as string | null} /> }
          ]}
        />
      </ProCard>

      <ProCard>
        <SectionTitle
          title="档案附件"
          extra={
            isAdmin && (
              <Button type="link" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit?tab=profile`)}>
                管理附件
              </Button>
            )
          }
        />
        <AttachmentList
          items={profile.attachments.map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size
          }))}
          allowDelete={false}
          emptyText="暂无档案附件"
        />
      </ProCard>
    </>
  ) : (
    <ProCard>
      <Empty
        description={
          <Space direction="vertical" size="small">
            <span>{isAdmin ? "暂无员工档案，可在编辑页补充" : "暂无员工档案"}</span>
            {isAdmin && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit`)}>
                补充档案
              </Button>
            )}
          </Space>
        }
      />
    </ProCard>
  );

  const tabItems = [
    { key: "account", label: "账号信息", children: accountTab },
    { key: "profile", label: "员工档案", children: profileTab }
  ];

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/users")}
        title={`${data.name} (${data.employeeNo})`}
        subtitle={`${data.email} · ${data.role?.name ?? data.roleId}`}
        meta={
          <Tag color={data.status === "ACTIVE" ? "green" : "default"}>
            {data.status === "ACTIVE" ? "启用" : "禁用"}
          </Tag>
        }
        actions={
          <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit`)}>
            编辑
          </Button>
        }
      />
      <Tabs defaultActiveKey="account" items={tabItems} />
    </Page>
  );
}
