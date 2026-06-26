"use client";
import { Avatar, Space, Tag, Button, Typography } from "antd";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { EditOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { AttachmentList } from "@/components/file/attachment-list";
import { ExpiryBadge } from "@/components/employee-profile/expiry-badge";
import { useDict } from "@/lib/dict-client";
import { formatGender, formatEmploymentType, formatDate, formatCurrency, maskIdCard, maskBankAccount, maskPhone } from "@/lib/format";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

const { Text } = Typography;

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

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";
  const { data, error, isLoading, mutate } = useSWR<{ data: FullEmployeeProfileDto | null }>(
    `/api/users/${id}/with-profile`
  );
  const { data: userResp, error: userError } = useSWR<User>(`/api/users/${id}`);
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  if (error || userError) {
    const e = error || userError;
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <ErrorBox title="加载失败" action={<Button size="small" onClick={() => mutate()}>重试</Button>}>
          {(e as Error).message}
        </ErrorBox>
      </Page>
    );
  }
  // 区分: data === undefined (SWR 还在 fetch) → skeleton; data.data === null (用户无 profile) → empty state
  // 老逻辑 !data?.data 在两种情况都 true, 无 profile 用户永远转 skeleton
  if (isLoading || data === undefined || !userResp) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="用户详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const user = userResp;
  const full = data.data;

  if (!full) {
    return (
      <Page>
        <PageHeader
          back={() => router.push("/admin/users")}
          title={user.name}
          subtitle={`${user.employeeNo} · ${user.email}`}
          meta={<Tag color={user.status === "ACTIVE" ? "green" : "default"}>{user.status === "ACTIVE" ? "启用" : "禁用"}</Tag>}
        />
        <ProCard>
          <Space direction="vertical" style={{ width: "100%", alignItems: "center", padding: 40 }}>
            <Text>暂无员工档案</Text>
            {isAdmin && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit-profile`)}>
                补充档案
              </Button>
            )}
          </Space>
        </ProCard>
      </Page>
    );
  }

  const { profile, educations, workExperiences, certificates, skills, emergencyContacts, avatar } = full;

  const educationLabel = (code: string | null) =>
    code ? educationDict.find((d) => d.code === code)?.label ?? code : "—";
  const contractTypeLabel = (code: string | null) =>
    code ? contractTypeDict.find((d) => d.code === code)?.label ?? code : "—";

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/users")}
        title={user.name}
        subtitle={`${user.employeeNo} · ${user.email}`}
        meta={
          <Tag color={user.status === "ACTIVE" ? "green" : "default"}>
            {user.status === "ACTIVE" ? "启用" : "禁用"}
          </Tag>
        }
        actions={
          isAdmin ? (
            <Space>
              <Button icon={<KeyOutlined />} onClick={() => router.push(`/admin/users/${id}/reset-password`)}>重置密码</Button>
              <Button
                icon={user.status === "ACTIVE" ? <StopOutlined /> : <CheckCircleOutlined />}
                onClick={async () => {
                  const next = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
                  const r = await fetch(`/api/users/${id}/toggle-status`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ status: next })
                  });
                  const j = await r.json();
                  if (j.code === 0) mutate();
                }}
              >
                {user.status === "ACTIVE" ? "禁用" : "启用"}
              </Button>
              <Button icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit`)}>编辑账号</Button>
              <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit-profile`)}>编辑档案</Button>
            </Space>
          ) : null
        }
      />

      <div>
        {/* 基础 */}
          <ProCard id="basic" title="基础" style={{ marginBottom: 16 }}>
            <Space size="large" align="start" style={{ marginBottom: 16 }}>
              <Avatar src={avatar?.url} size={80} style={{ backgroundColor: "#1677ff" }}>
                {user.name?.[0]}
              </Avatar>
              <ProDescriptions column={2} dataSource={profile} columns={[
                { title: "性别", dataIndex: "gender", render: (v: unknown) => formatGender(v as string) },
                { title: "生日", dataIndex: "birthday", render: (v: unknown) => formatDate(v as string) },
                { title: "学历", dataIndex: "education", render: (v: unknown) => educationLabel(v as string) },
                { title: "入职日期", dataIndex: "entryDate", render: (v: unknown) => formatDate(v as string) },
                { title: "住址", dataIndex: "addressDetail", span: 2, render: (v: unknown) => {
                  const r = v as string | null;
                  if (!r && !profile.province) return "—";
                  return `${profile.province ?? ""} ${profile.city ?? ""} ${profile.district ?? ""} ${r ?? ""}`.trim() || "—";
                } }
              ]} />
            </Space>
            <Text strong>紧急联系人</Text>
            {emergencyContacts.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>
                {emergencyContacts.map((c) => (
                  <li key={c.id}>{c.name}({c.relationship}) {maskPhone(c.phone)}{c.remark ? ` · ${c.remark}` : ""}</li>
                ))}
              </ul>
            )}
          </ProCard>

          {/* 岗位合同 */}
          <ProCard id="position" title="岗位与合同" style={{ marginBottom: 16 }}>
            <ProDescriptions column={2} dataSource={profile} columns={[
              { title: "岗位", dataIndex: "position", render: (v: unknown) => (v as string) || "—" },
              { title: "职级", dataIndex: "jobLevel", render: (v: unknown) => (v as string) || "—" },
              { title: "用工类型", dataIndex: "employmentType", render: (v: unknown) => formatEmploymentType(v as string) },
              { title: "试用期结束", dataIndex: "probationEndDate", render: (v: unknown) => formatDate(v as string) },
              { title: "转正日期", dataIndex: "formalDate", render: (v: unknown) => formatDate(v as string) },
              { title: "离职日期", dataIndex: "resignationDate", render: (v: unknown) => formatDate(v as string) },
              { title: "合同类型", dataIndex: "contractType", render: (v: unknown) => contractTypeLabel(v as string) },
              { title: "合同起止", dataIndex: "contractStartDate", render: (_: unknown, r: typeof profile) => `${formatDate(r.contractStartDate)} ~ ${formatDate(r.contractEndDate)}` }
            ]} />
          </ProCard>

          {/* 敏感(仅 ADMIN) */}
          {isAdmin && (
            <ProCard
              id="sensitive"
              title={<Space>敏感信息 <Tag color="red">仅管理员</Tag></Space>}
              style={{ marginBottom: 16 }}
            >
              <ProDescriptions column={2} dataSource={profile} columns={[
                { title: "身份证", dataIndex: "idCard", render: (v: unknown) => v ? maskIdCard(v as string) : "—" },
                { title: "薪资", dataIndex: "salary", render: (v: unknown) => v != null ? <Text strong>{formatCurrency(v as number)}</Text> : "—" },
                { title: "银行卡号", dataIndex: "bankAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" },
                { title: "开户行", dataIndex: "bankName", render: (v: unknown) => (v as string) || "—" },
                { title: "社保账号", dataIndex: "socialSecurityAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" },
                { title: "公积金账号", dataIndex: "providentFundAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" }
              ]} />
            </ProCard>
          )}

          {/* 履历 */}
          <ProCard id="history" title="履历" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <Text strong>工作经历</Text>
              {workExperiences.length === 0 ? <div><Text type="secondary">—</Text></div> : (
                <ul style={{ marginTop: 4 }}>
                  {workExperiences.map((w) => (
                    <li key={w.id}>{w.company} · {w.position ?? "—"} · {formatDate(w.startDate)} ~ {w.endDate ? formatDate(w.endDate) : "至今"}{w.leaveReason ? ` (离职:${w.leaveReason})` : ""}{w.referrer ? ` · 证明人:${w.referrer}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>教育经历</Text>
              {educations.length === 0 ? <div><Text type="secondary">—</Text></div> : (
                <ul style={{ marginTop: 4 }}>
                  {educations.map((e) => (
                    <li key={e.id}>{e.school} · {e.major ?? "—"} · {educationLabel(e.degree)} · {formatDate(e.startDate)} ~ {e.endDate ? formatDate(e.endDate) : "至今"}{e.isFullTime ? " (全日制)" : ""}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>技能</Text>
              {skills.length === 0 ? <div><Text type="secondary">—</Text></div> : (
                <ul style={{ marginTop: 4 }}>
                  {skills.map((s) => (
                    <li key={s.id}>{s.name} · {s.level}{s.obtainDate ? ` · ${formatDate(s.obtainDate)}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
            {profile.remark && (
              <div>
                <Text strong>备注</Text>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{profile.remark}</div>
              </div>
            )}
          </ProCard>

          {/* 证书与附件 */}
          <ProCard id="certs" title="证书与附件" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <Text strong>证书</Text>
              {certificates.length === 0 ? <div><Text type="secondary">—</Text></div> : (
                <ul style={{ marginTop: 4 }}>
                  {certificates.map((c) => (
                    <li key={c.id}>
                      {c.name} · {c.number ?? "—"} · {c.issuer ?? "—"}
                      {c.issueDate ? ` · ${formatDate(c.issueDate)}` : ""} ~ {c.expiryDate ? formatDate(c.expiryDate) : "无到期日"} <ExpiryBadge expiryDate={c.expiryDate} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <Text strong>其他附件</Text>
              <AttachmentList
                items={(profile.attachments ?? []).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size }))}
                allowDelete={false}
                emptyText="—"
              />
            </div>
          </ProCard>
      </div>
    </Page>
  );
}
