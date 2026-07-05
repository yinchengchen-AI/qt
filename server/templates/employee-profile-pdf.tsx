// 员工档案 PDF 模板 (HR 入职材料包)
/* eslint-disable jsx-a11y/alt-text -- react-pdf Image 不是 HTML img,jsx-a11y 规则不适用 */
import { Document, Page, Text, View, StyleSheet, Font, Image } from "@react-pdf/renderer";

Font.register({
  family: "Noto Sans SC",
  src: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.5/files/noto-sans-sc-chinese-simplified-400-normal.woff2"
});

const COLORS = { primary: "#1677ff", text: "#262626", muted: "#8c8c8c", border: "#e5e7eb", bg: "#f5f5f5" };

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: COLORS.text, lineHeight: 1.5 },
  banner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: COLORS.primary, paddingBottom: 12, marginBottom: 16 },
  bannerTitle: { fontSize: 18, fontWeight: 700, color: COLORS.primary },
  bannerMeta: { fontSize: 9, color: COLORS.muted, textAlign: "right" },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: COLORS.primary, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  row2: { flexDirection: "row", gap: 12, marginBottom: 3 },
  col2: { flexDirection: "row", flex: 1 },
  label: { color: COLORS.muted, minWidth: 70 },
  value: { color: COLORS.text, flex: 1 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 12 },
  avatarImg: { width: 72, height: 72, borderRadius: 36, objectFit: "cover" },
  avatarFallback: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary, color: "#fff", fontSize: 32, textAlign: "center", paddingTop: 16 },
  subTable: { marginBottom: 6 },
  subRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 4 },
  subHead: { fontSize: 10, fontWeight: 700, color: COLORS.text, flex: 1 },
  subCell: { fontSize: 9, flex: 1, color: COLORS.text },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: COLORS.muted, textAlign: "center", borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6 }
});

function fmt(v: string | null | undefined, fallback = "—") { return v == null || v === "" ? fallback : v; }
function fmtDate(v: string | null | undefined) { if (!v) return "—"; return v.slice(0, 10); }

function HeroBlock({ user, profile, avatarUrl }: { user: { name: string; employeeNo: string }; profile: Record<string, string | null>; avatarUrl: string | null }) {
  return (
    <View style={s.hero}>
      {avatarUrl ? <Image src={avatarUrl} style={s.avatarImg} /> : <Text style={s.avatarFallback}>{user.name?.[0] ?? "?"}</Text>}
      <View style={{ flex: 1 }}>
        <View style={s.row2}><View style={s.col2}><Text style={s.label}>工号</Text><Text style={s.value}>{fmt(user.employeeNo)}</Text></View><View style={s.col2}><Text style={s.label}>姓名</Text><Text style={s.value}>{fmt(user.name)}</Text></View></View>
        <View style={s.row2}><View style={s.col2}><Text style={s.label}>性别</Text><Text style={s.value}>{fmt(profile.gender)}</Text></View><View style={s.col2}><Text style={s.label}>生日</Text><Text style={s.value}>{fmtDate(profile.birthday)}</Text></View></View>
        <View style={s.row2}><View style={s.col2}><Text style={s.label}>身份证</Text><Text style={s.value}>{fmt(profile.idCard)}</Text></View><View style={s.col2}><Text style={s.label}>学历</Text><Text style={s.value}>{fmt(profile.education)}</Text></View></View>
        <View style={s.row2}><View style={s.col2}><Text style={s.label}>入职日期</Text><Text style={s.value}>{fmtDate(profile.entryDate)}</Text></View></View>
      </View>
    </View>
  );
}

function SectionBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {rows.map(([k, v], i) => <View key={i} style={s.row2}><View style={s.col2}><Text style={s.label}>{k}</Text><Text style={s.value}>{v}</Text></View></View>)}
    </View>
  );
}

function SubTableBlock({ title, headers, rows }: { title: string; headers: string[]; rows: Array<{ head: string; cells: string[] }> }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.subTable}>
        <View style={{ ...s.subRow, backgroundColor: COLORS.bg }}>
          {headers.map((h, i) => <Text key={i} style={s.subHead}>{h}</Text>)}
        </View>
        {rows.map((r, i) => <View key={i} style={s.subRow}>{r.cells.map((c, j) => <Text key={j} style={s.subCell}>{c || "—"}</Text>)}</View>)}
      </View>
    </View>
  );
}

export type EmployeeProfilePdfData = {
  user: { name: string; employeeNo: string };
  profile: Record<string, string | null>;
  educations: Array<{ school: string; major: string | null; degree: string | null; startDate: string; endDate: string | null }>;
  workExperiences: Array<{ company: string; position: string | null; startDate: string; endDate: string | null; leaveReason: string | null }>;
  certificates: Array<{ name: string; number: string | null; issuer: string | null; issueDate: string | null; expiryDate: string | null }>;
  skills: Array<{ name: string; level: string | null; obtainDate: string | null }>;
  emergencyContacts: Array<{ name: string; relationship: string; phone: string }>;
  avatarUrl: string | null;
  generatedAt: string;
  docVersion: string;
};

export function EmployeeProfilePdf({ data }: { data: EmployeeProfilePdfData }) {
  const { user, profile, educations, workExperiences, certificates, skills, emergencyContacts, avatarUrl, generatedAt, docVersion } = data;
  const fullAddress = [profile.province, profile.city, profile.district, profile.addressDetail].filter(Boolean).join(" ") || null;
  return (
    <Document title={`${user.name} - 员工档案`} author="qt-biz">
      <Page size="A4" style={s.page}>
        <View style={s.banner}>
          <Text style={s.bannerTitle}>员工档案</Text>
          <View>
            <Text style={s.bannerMeta}>工号: {user.employeeNo}</Text>
            <Text style={s.bannerMeta}>生成时间: {generatedAt}</Text>
          </View>
        </View>
        <HeroBlock user={user} profile={profile} avatarUrl={avatarUrl} />
        <SectionBlock title="岗位与合同" rows={[
          ["岗位", fmt(profile.position)], ["职级", fmt(profile.jobLevel)], ["用工类型", fmt(profile.employmentType)],
          ["试用期至", fmtDate(profile.probationEndDate)], ["转正日期", fmtDate(profile.formalDate)], ["离职日期", fmtDate(profile.resignationDate)],
          ["合同类型", fmt(profile.contractType)], ["合同起", fmtDate(profile.contractStartDate)], ["合同止", fmtDate(profile.contractEndDate)]
        ]} />
        {fullAddress ? <SectionBlock title="地址" rows={[["现居地址", fullAddress]]} /> : null}
        <SubTableBlock title="紧急联系人" headers={["姓名", "关系", "电话"]} rows={emergencyContacts.map((c) => ({ head: c.name, cells: [c.name, c.relationship, c.phone] }))} />
        <SubTableBlock title="工作经历" headers={["公司", "岗位", "起", "止", "离职原因"]} rows={workExperiences.map((w) => ({ head: w.company, cells: [w.company, fmt(w.position), fmtDate(w.startDate), fmtDate(w.endDate), fmt(w.leaveReason)] }))} />
        <SubTableBlock title="教育经历" headers={["学校", "专业", "学历", "起", "止"]} rows={educations.map((e) => ({ head: e.school, cells: [e.school, fmt(e.major), fmt(e.degree), fmtDate(e.startDate), fmtDate(e.endDate)] }))} />
        <SubTableBlock title="技能" headers={["技能", "熟练度", "取得日期"]} rows={skills.map((sk) => ({ head: sk.name, cells: [sk.name, fmt(sk.level), fmtDate(sk.obtainDate)] }))} />
        <SubTableBlock title="证书" headers={["名称", "编号", "颁发机构", "颁发日期", "到期日期"]} rows={certificates.map((c) => ({ head: c.name, cells: [c.name, fmt(c.number), fmt(c.issuer), fmtDate(c.issueDate), fmtDate(c.expiryDate)] }))} />
        {profile.remark ? <View style={s.section}><Text style={s.sectionTitle}>备注</Text><Text style={{ fontSize: 9, lineHeight: 1.5 }}>{profile.remark}</Text></View> : null}
        <Text style={s.footer} fixed>qt-biz 员工档案 · 文档版本 {docVersion} · 此件仅供内部使用</Text>
      </Page>
    </Document>
  );
}
