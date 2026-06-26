"use client";
import { Avatar, Space, Tag, Button, Typography, Card, Row, Col, Divider, Empty } from "antd";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { EditOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined, IdcardOutlined, BankOutlined, BookOutlined, FileProtectOutlined, ApartmentOutlined, UserOutlined, PhoneOutlined, CalendarOutlined, EnvironmentOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
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
import { EmptyState } from "@/components/empty-state";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text, Title } = Typography;

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

type Section = { id: string; label: string; icon: React.ReactNode };

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/admin/users");
  const { isMobile } = useResponsive();
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
        <PageHeader back={goBack} title="用户详情" />
        <ErrorBox title="加载失败" action={<Button size="small" onClick={() => mutate()}>重试</Button>}>
          {(e as Error).message}
        </ErrorBox>
      </Page>
    );
  }
  if (isLoading || data === undefined || !userResp) {
    return (
      <Page>
        <PageHeader back={goBack} title="用户详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const user = userResp;
  const full = data.data;

  // 顶部锚点导航:概览 / 基础 / 岗位 / 敏感 / 履历 / 证书
  // 仅当档案存在 + 仅 admin 显示敏感
  const sections: Section[] = [
    { id: "overview", label: "概览", icon: <UserOutlined /> },
    { id: "basic", label: "基础", icon: <IdcardOutlined /> },
    { id: "position", label: "岗位与合同", icon: <ApartmentOutlined /> },
    ...(isAdmin ? [{ id: "sensitive", label: "敏感信息", icon: <BankOutlined /> } as Section] : []),
    { id: "history", label: "履历", icon: <BookOutlined /> },
    { id: "certs", label: "证书与附件", icon: <FileProtectOutlined /> }
  ];

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 无档案: 展示引导 + 必要的账号元信息
  if (!full) {
    return (
      <Page>
        <HeroHeader
          user={user}
          isAdmin={isAdmin}
          id={id}
          onEditProfile={() => router.push(`/admin/users/${id}/edit-profile`)}
        />
        <ProCard style={{ marginTop: 8 }}>
          <EmptyState
            icon={<IdcardOutlined style={{ fontSize: 48, color: "var(--qt-text-faint)" }} />}
            title="暂无员工档案"
            description={
              <>
                <span>该账号仅有关键信息,</span>
                <span>可补充档案以记录任职、教育、证书等。</span>
              </>
            }
            action={
              isAdmin ? (
                <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit-profile`)}>
                  补充档案
                </Button>
              ) : null
            }
            height="tall"
          />
        </ProCard>
      </Page>
    );
  }

  const { profile, educations, workExperiences, certificates, skills, emergencyContacts, avatar } = full;

  const educationLabel = (code: string | null) =>
    code ? educationDict.find((d) => d.code === code)?.label ?? code : "—";
  const contractTypeLabel = (code: string | null) =>
    code ? contractTypeDict.find((d) => d.code === code)?.label ?? code : "—";
  const fullAddress = profile.province || profile.city || profile.district || profile.addressDetail
    ? `${profile.province ?? ""} ${profile.city ?? ""} ${profile.district ?? ""} ${profile.addressDetail ?? ""}`.trim()
    : null;

  // 概览 KPI
  const kpis = [
    { label: "紧急联系人", value: emergencyContacts.length, suffix: "人" },
    { label: "工作经历", value: workExperiences.length, suffix: "段" },
    { label: "教育经历", value: educations.length, suffix: "段" },
    { label: "证书", value: certificates.length, suffix: "份" }
  ];

  return (
    <Page>
      <HeroHeader
        user={user}
        isAdmin={isAdmin}
        id={id}
        onEditProfile={() => router.push(`/admin/users/${id}/edit-profile`)}
      />

      <AnchorNav sections={sections} onJump={scrollTo} compact={isMobile} />

      {/* 概览 */}
      <ProCard id="overview" style={{ marginBottom: 16 }} title="概览" headerBordered>
        <Row gutter={[12, 12]}>
          {kpis.map((k) => (
            <Col key={k.label} xs={12} sm={12} md={6}>
              <Card size="small" styles={{ body: { padding: 16 } }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{k.label}</Text>
                <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>
                  {k.value}
                  <Text type="secondary" style={{ fontSize: 13, marginLeft: 4 }}>{k.suffix}</Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
        <Divider style={{ margin: "16px 0" }} />
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <KeyValue label="工号" value={<Text copyable>{user.employeeNo}</Text>} />
            <KeyValue label="邮箱" value={<Text copyable>{user.email}</Text>} />
            <KeyValue label="手机" value={user.phone ? <Text copyable>{user.phone}</Text> : "—"} />
          </Col>
          <Col xs={24} sm={12}>
            <KeyValue label="角色" value={<Tag color="blue">{user.role?.name ?? user.roleId}</Tag>} />
            <KeyValue label="部门" value={user.department?.name ?? <Text type="secondary">未分配</Text>} />
            <KeyValue label="入职日期" value={profile.entryDate ? formatDate(profile.entryDate) : "—"} />
            <KeyValue label="最近登录" value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "从未登录"} />
          </Col>
        </Row>
      </ProCard>

      {/* 基础 */}
      <ProCard
        id="basic"
        title={
          <Space>
            <IdcardOutlined />
            <span>基础</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
        headerBordered
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
          <Col xs={24} sm={8}>
            <CenterAvatar url={avatar?.url} name={user.name} />
          </Col>
          <Col xs={24} sm={16}>
            <ProDescriptions column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2 }} dataSource={profile} columns={[
              { title: "性别", dataIndex: "gender", render: (v: unknown) => formatGender(v as string) },
              { title: "生日", dataIndex: "birthday", render: (v: unknown) => formatDate(v as string) },
              { title: "最高学历", dataIndex: "education", render: (v: unknown) => educationLabel(v as string) },
              { title: "身份证", dataIndex: "idCard", render: (v: unknown) => v ? maskIdCard(v as string) : "—" },
              { title: "住址", dataIndex: "addressDetail", span: 2, render: () => fullAddress ?? "—" }
            ]} />
          </Col>
        </Row>
        <Divider style={{ margin: "12px 0" }} titlePlacement="left">
          <Text type="secondary" style={{ fontSize: 13 }}>紧急联系人 ({emergencyContacts.length})</Text>
        </Divider>
        {emergencyContacts.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未填写紧急联系人" />
        ) : (
          <Row gutter={[12, 12]}>
            {emergencyContacts.map((c) => (
              <Col key={c.id} xs={24} sm={12} md={8}>
                <Card size="small" styles={{ body: { padding: 12 } }} style={{ background: "var(--qt-bg-subtle)" }}>
                  <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                    <Space size={6}>
                      <Text strong>{c.name}</Text>
                      <Tag color="purple" style={{ margin: 0 }}>{c.relationship}</Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <PhoneOutlined style={{ marginRight: 4 }} />
                      {maskPhone(c.phone)}
                    </Text>
                    {c.remark ? <Text type="secondary" style={{ fontSize: 12 }}>{c.remark}</Text> : null}
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </ProCard>

      {/* 岗位与合同 */}
      <ProCard
        id="position"
        title={
          <Space>
            <ApartmentOutlined />
            <span>岗位与合同</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
        headerBordered
      >
        <ProDescriptions column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3 }} dataSource={profile} columns={[
          { title: "岗位", dataIndex: "position", render: (v: unknown) => (v as string) || "—" },
          { title: "职级", dataIndex: "jobLevel", render: (v: unknown) => (v as string) || "—" },
          { title: "用工类型", dataIndex: "employmentType", render: (v: unknown) => formatEmploymentType(v as string) },
          { title: "试用期结束", dataIndex: "probationEndDate", render: (v: unknown) => formatDate(v as string) },
          { title: "转正日期", dataIndex: "formalDate", render: (v: unknown) => formatDate(v as string) },
          { title: "离职日期", dataIndex: "resignationDate", render: (v: unknown) => formatDate(v as string) },
          { title: "合同类型", dataIndex: "contractType", render: (v: unknown) => contractTypeLabel(v as string) },
          { title: "合同起止", dataIndex: "contractStartDate", span: 2, render: (_: unknown, r: typeof profile) => {
            if (!r.contractStartDate && !r.contractEndDate) return "—";
            return `${formatDate(r.contractStartDate)} ~ ${formatDate(r.contractEndDate)}`;
          } }
        ]} />
      </ProCard>

      {/* 敏感(仅 ADMIN) */}
      {isAdmin && (
        <ProCard
          id="sensitive"
          title={
            <Space>
              <BankOutlined />
              <span>敏感信息</span>
              <Tag color="red" style={{ margin: 0 }}>仅管理员可见</Tag>
            </Space>
          }
          style={{ marginBottom: 16 }}
          headerBordered
        >
          <ProDescriptions column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3 }} dataSource={profile} columns={[
            { title: "薪资", dataIndex: "salary", render: (v: unknown) => v != null ? <Text strong style={{ color: "var(--qt-success)" }}>{formatCurrency(v as number)}</Text> : "—" },
            { title: "身份证", dataIndex: "idCard", render: (v: unknown) => v ? maskIdCard(v as string) : "—" },
            { title: "银行卡号", dataIndex: "bankAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" },
            { title: "开户行", dataIndex: "bankName", render: (v: unknown) => (v as string) || "—" },
            { title: "社保账号", dataIndex: "socialSecurityAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" },
            { title: "公积金账号", dataIndex: "providentFundAccount", render: (v: unknown) => v ? maskBankAccount(v as string) : "—" }
          ]} />
        </ProCard>
      )}

      {/* 履历 */}
      <ProCard
        id="history"
        title={
          <Space>
            <BookOutlined />
            <span>履历</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
        headerBordered
      >
        <SubListSection
          title="工作经历"
          count={workExperiences.length}
          empty="尚未填写工作经历"
          columns={isMobile ? 1 : 2}
          items={workExperiences.map((w) => ({
            key: w.id,
            head: <Space size={6}><Text strong>{w.company}</Text>{w.position ? <Tag color="blue">{w.position}</Tag> : null}</Space>,
            rows: [
              { icon: <CalendarOutlined />, text: `${formatDate(w.startDate)} ~ ${w.endDate ? formatDate(w.endDate) : "至今"}` },
              w.leaveReason ? { icon: <EnvironmentOutlined />, text: `离职:${w.leaveReason}` } : null,
              w.referrer ? { icon: <UserOutlined />, text: `证明人:${w.referrer}` } : null,
              w.remark ? { text: w.remark, muted: true } : null
            ].filter(Boolean) as Array<{ icon?: React.ReactNode; text: React.ReactNode; muted?: boolean }>
          }))}
        />
        <Divider style={{ margin: "12px 0" }} />
        <SubListSection
          title="教育经历"
          count={educations.length}
          empty="尚未填写教育经历"
          columns={isMobile ? 1 : 2}
          items={educations.map((e) => ({
            key: e.id,
            head: <Space size={6}><Text strong>{e.school}</Text>{e.major ? <Tag>{e.major}</Tag> : null}</Space>,
            rows: [
              { icon: <CalendarOutlined />, text: `${formatDate(e.startDate)} ~ ${e.endDate ? formatDate(e.endDate) : "至今"}` },
              { text: `${educationLabel(e.degree)}${e.isFullTime ? " · 全日制" : ""}` }
            ]
          }))}
        />
        <Divider style={{ margin: "12px 0" }} />
        <SubListSection
          title="技能"
          count={skills.length}
          empty="尚未填写技能"
          columns={isMobile ? 1 : 3}
          items={skills.map((s) => ({
            key: s.id,
            head: <Space size={6}><Text strong>{s.name}</Text><Tag color="cyan">{SKILL_LEVEL_LABEL[s.level] ?? s.level}</Tag></Space>,
            rows: s.obtainDate ? [{ icon: <CalendarOutlined />, text: formatDate(s.obtainDate) }] : [],
            remark: s.remark
          }))}
        />
        {profile.remark && (
          <>
            <Divider style={{ margin: "12px 0" }} />
            <div>
              <Text type="secondary" style={{ fontSize: 13 }}>备注</Text>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 6, padding: 12, background: "var(--qt-bg-subtle)", borderRadius: 6 }}>
                {profile.remark}
              </div>
            </div>
          </>
        )}
      </ProCard>

      {/* 证书与附件 */}
      <ProCard
        id="certs"
        title={
          <Space>
            <FileProtectOutlined />
            <span>证书与附件</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
        headerBordered
      >
        <SubListSection
          title="证书"
          count={certificates.length}
          empty="尚未填写证书"
          columns={isMobile ? 1 : 2}
          items={certificates.map((c) => ({
            key: c.id,
            head: (
              <Space size={6} wrap>
                <Text strong>{c.name}</Text>
                {c.number ? <Tag>{c.number}</Tag> : null}
                <ExpiryBadge expiryDate={c.expiryDate} />
              </Space>
            ),
            rows: [
              c.issuer ? { icon: <UserOutlined />, text: c.issuer } : null,
              { icon: <CalendarOutlined />, text: c.issueDate ? `${formatDate(c.issueDate)} ~ ${c.expiryDate ? formatDate(c.expiryDate) : "无到期日"}` : "未填颁发日" }
            ].filter(Boolean) as Array<{ icon?: React.ReactNode; text: React.ReactNode; muted?: boolean }>
          }))}
        />
        <Divider style={{ margin: "12px 0" }} />
        <div>
          <Text type="secondary" style={{ fontSize: 13 }}>其他附件</Text>
          <div style={{ marginTop: 8 }}>
            <AttachmentList
              items={(profile.attachments ?? []).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size }))}
              allowDelete={false}
              emptyText="—"
            />
          </div>
        </div>
      </ProCard>
    </Page>
  );
}

const SKILL_LEVEL_LABEL: Record<string, string> = {
  BEGINNER: "初级",
  INTERMEDIATE: "中级",
  ADVANCED: "高级"
};

function KeyValue({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px dashed var(--qt-border-soft)" }}>
      <Text type="secondary" style={{ minWidth: 64, fontSize: 12 }}>{label}</Text>
      <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>{value}</div>
    </div>
  );
}

function CenterAvatar({ url, name }: { url?: string; name: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}>
      <Avatar src={url} size={88} style={{ backgroundColor: "var(--qt-processing)", fontSize: 32, fontWeight: 600 }}>
        {name?.[0]}
      </Avatar>
    </div>
  );
}

type SubItem = {
  key: string;
  head: React.ReactNode;
  rows: Array<{ icon?: React.ReactNode; text: React.ReactNode; muted?: boolean }>;
  remark?: string | null;
};

function SubListSection({
  title,
  count,
  empty,
  columns,
  items
}: {
  title: string;
  count: number;
  empty: string;
  columns: 1 | 2 | 3;
  items: SubItem[]
}) {
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 8, display: "block" }}>
        {title} <Tag style={{ marginLeft: 4 }}>{count}</Tag>
      </Text>
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
      ) : (
        <Row gutter={[12, 12]}>
          {items.map((it) => (
            <Col key={it.key} xs={24} sm={24 / columns as 24 | 12 | 8}>
              <Card size="small" styles={{ body: { padding: 12 } }} style={{ background: "var(--qt-bg-subtle)" }}>
                <div style={{ marginBottom: 6 }}>{it.head}</div>
                {it.rows.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: r.muted ? "var(--qt-text-faint)" : "var(--qt-text-muted)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    {r.icon ? <span style={{ color: "var(--qt-text-faint)" }}>{r.icon}</span> : null}
                    <span>{r.text}</span>
                  </div>
                ))}
                {it.remark ? <div style={{ fontSize: 12, color: "var(--qt-text-faint)", marginTop: 4 }}>{it.remark}</div> : null}
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

function AnchorNav({ sections, onJump, compact }: { sections: Section[]; onJump: (id: string) => void; compact?: boolean }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 64,
        zIndex: 5,
        marginBottom: 16,
        padding: compact ? "6px 8px" : "8px 12px",
        background: "var(--qt-bg)",
        border: "1px solid var(--qt-border-soft)",
        borderRadius: 8,
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
      }}
    >
      {sections.map((s) => (
        <Button
          key={s.id}
          type="text"
          size="small"
          icon={s.icon}
          onClick={() => onJump(s.id)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}

function HeroHeader({
  user,
  isAdmin,
  id,
  onEditProfile
}: {
  user: User;
  isAdmin: boolean;
  id: string;
  onEditProfile: () => void;
}) {
  return (
    <ProCard
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: compactSpacing() } }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 16 }}>
        <Avatar
          size={72}
          style={{ backgroundColor: "var(--qt-processing)", fontSize: 28, fontWeight: 600, flexShrink: 0 }}
        >
          {user.name?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={8} wrap style={{ marginBottom: 4 }}>
            <Title level={3} style={{ margin: 0 }}>{user.name}</Title>
            <Tag color="blue">{user.employeeNo}</Tag>
            <Tag color={user.status === "ACTIVE" ? "success" : "default"}>
              {user.status === "ACTIVE" ? "启用" : "禁用"}
            </Tag>
          </Space>
          <Space size={16} wrap style={{ color: "var(--qt-text-muted)", fontSize: 13 }}>
            <span><IdcardOutlined style={{ marginRight: 4 }} />{user.email}</span>
            {user.phone ? <span><PhoneOutlined style={{ marginRight: 4 }} />{user.phone}</span> : null}
            <span><ApartmentOutlined style={{ marginRight: 4 }} />{user.department?.name ?? "未分配部门"}</span>
            <span><UserOutlined style={{ marginRight: 4 }} />{user.role?.name ?? user.roleId}</span>
          </Space>
        </div>
        {isAdmin ? (
          <Space wrap style={{ flexShrink: 0 }}>
            <Button
              icon={<KeyOutlined />}
              onClick={() => {/* 与详情页 actions 保持一致,跳到重置页 */}}
            >
              重置密码
            </Button>
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
                if (j.code === 0) window.location.reload();
              }}
            >
              {user.status === "ACTIVE" ? "禁用" : "启用"}
            </Button>
            <Button icon={<EditOutlined />} onClick={() => window.location.assign(`/admin/users/${id}/edit`)}>
              编辑账号
            </Button>
            <Button type="primary" icon={<EditOutlined />} onClick={onEditProfile}>
              编辑档案
            </Button>
          </Space>
        ) : null}
      </div>
    </ProCard>
  );
}

function compactSpacing(): string {
  return "20px 24px";
}
