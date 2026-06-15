// 详情页 type-specific 渲染(右栏基本信息展示)
// 关键链接:PERFORMANCE / CASE 中"客户 / 合同 / 项目"显示为可点击 Link,跳到对应详情
import { Descriptions, Tag, Spin, Button } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SERVICE_TYPE_MAP } from "@/lib/enum-maps";

function fmtDate(v: unknown): string {
  if (!v) return "-";
  const d = typeof v === "string" ? new Date(v) : v instanceof Date ? v : null;
  if (!d || isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

const serviceTypeLabel = (s: string) => SERVICE_TYPE_MAP[s] ?? s;

function renderPairs(pairs: Array<[string, React.ReactNode]>): React.JSX.Element {
  return (
    <Descriptions column={1} size="small" bordered>
      {pairs.map(([k, v]) => (
        <Descriptions.Item key={k} label={k}>{v ?? "-"}</Descriptions.Item>
      ))}
    </Descriptions>
  );
}

export function LicenseRenderer({ a }: { a: Record<string, unknown> }) {
  return renderPairs([
    ["统一社会信用代码", String(a.unifiedSocialCreditCode ?? "-")],
    ["法定代表人", String(a.legalRepresentative ?? "-")],
    ["注册资本", String(a.registeredCapital ?? "-")],
    ["成立日期", fmtDate(a.establishDate)],
    ["经营范围", String(a.businessScope ?? "-")],
    ["注册地址", String(a.address ?? "-")]
  ]);
}

export function CertificateRenderer({ a }: { a: Record<string, unknown> }) {
  return renderPairs([
    ["证书编号", String(a.certificateNo ?? "-")],
    ["颁发机构", String(a.issuingAuthority ?? "-")],
    ["等级", a.gradeLevel ? <Tag color="blue">{String(a.gradeLevel)}</Tag> : "-"],
    ["资质类别", String(a.category ?? "-")]
  ]);
}

export function QualificationRenderer({ a }: { a: Record<string, unknown> }) {
  return renderPairs([
    ["标准", String(a.standard ?? "-")],
    ["证书编号", String(a.certificateNo ?? "-")],
    ["认证机构", String(a.issuingAuthority ?? "-")],
    ["认证范围", String(a.scope ?? "-")]
  ]);
}

type RefKind = "customer" | "contract" | "project";

/** 远程实体的轻量引用 — 自动拉 name/title 后渲染为跳转链接 */
function useEntityRef(id: string | null | undefined, endpoint: string, kind: RefKind) {
  const [info, setInfo] = useState<{ name: string; href: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) { setInfo(null); return; }
    const ac = new AbortController();
    setLoading(true);
    fetch(`/api/${endpoint}/${id}`, { credentials: "include", signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.code !== 0) { setInfo(null); return; }
        const d = j.data;
        const name = d?.name ?? d?.title ?? d?.contractNo ?? id;
        const href = kind === "customer" ? `/customers/${id}` : kind === "contract" ? `/contracts/${id}` : `/projects/${id}`;
        setInfo({ name, href });
      })
      .catch((e) => {
        // AbortError 是卸载/依赖变更的预期路径,静默忽略
        if (e?.name !== "AbortError") setInfo(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [id, endpoint, kind]);
  if (!id) return <span style={{ color: "#999" }}>—</span>;
  if (loading) return <Spin size="small" />;
  if (!info) return <span style={{ color: "#999" }}>{id}(已删除)</span>;
  return <Link href={info.href} target="_blank" style={{ color: "#1677ff" }}>{info.name} ↗</Link>;
}

export function PerformanceRenderer({ a }: { a: Record<string, unknown> }) {
  const customerId = a.customerId as string | undefined;
  const contractId = a.contractId as string | undefined;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card label="关联客户" body={useEntityRef(customerId, "customers", "customer")} fallback={String(a.customerName ?? "")} />
        <Card label="关联合同" body={useEntityRef(contractId, "contracts", "contract")} />
        <Card label="合同金额" body={
          <span style={{ fontSize: 16, color: "#1677ff", fontWeight: 600 }}>
            {a.contractAmount != null ? `¥${Number(a.contractAmount).toLocaleString()}` : "—"}
          </span>
        } />
      </div>
      {renderPairs([
        ["项目名称", String(a.projectName ?? "-")],
        ["客户名称", String(a.customerName ?? "-")],
        ["客户联系方式", String(a.customerContact ?? "-")],
        ["服务类型", serviceTypeLabel(String(a.serviceType ?? "")) || "-"],
        ["签订日期", fmtDate(a.signDate)],
        ["完成日期", fmtDate(a.completedDate)]
      ])}
    </div>
  );
}

function Card({ label, body, fallback }: { label: string; body: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 6 }}>
      <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#333" }}>{body ?? fallback ?? <span style={{ color: "#999" }}>—</span>}</div>
    </div>
  );
}

export function TeamMemberRenderer({ a }: { a: Record<string, unknown> }) {
  const certs = Array.isArray(a.certificates) ? a.certificates : [];
  return (
    <>
      {renderPairs([
        ["内部员工 ID", String(a.userId ?? "-")],
        ["外部姓名", String(a.externalName ?? "-")],
        ["外部电话", String(a.externalPhone ?? "-")],
        ["职称/职务", String(a.title ?? "-")],
        ["专业方向", String(a.specialty ?? "-")],
        ["从业年限", String(a.yearsOfExperience ?? "-")],
        ["证书数", String(certs.length)]
      ])}
      {certs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>证书列表</strong>
          <ul style={{ marginTop: 4 }}>
            {certs.map((c: Record<string, unknown>, i: number) => (
              <li key={i}>
                {String(c.name ?? "-")} {c.no ? `(编号: ${String(c.no)})` : ""} {c.validTo ? `到期: ${fmtDate(c.validTo)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.resumeMarkdown && (
        <div style={{ marginTop: 12 }}>
          <strong>简历</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: "#fafafa", padding: 8, marginTop: 4, borderRadius: 4 }}>
            {String(a.resumeMarkdown)}
          </pre>
        </div>
      )}
    </>
  );
}

export function CaseRenderer({ a }: { a: Record<string, unknown> }) {
  const projectId = a.projectId as string | undefined;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card label="关联项目" body={useEntityRef(projectId, "projects", "project")} />
        <Card label="服务类型" body={
          <span style={{ fontSize: 16, fontWeight: 600 }}>{serviceTypeLabel(String(a.serviceType ?? "")) || "—"}</span>
        } />
      </div>
      {renderPairs([
        ["案例标题", String(a.title ?? "-")],
        ["客户名称", String(a.customerName ?? "-")],
        ["年份", String(a.year ?? "-")],
        ["项目内容", String(a.scope ?? "-")],
        ["项目亮点", String(a.highlights ?? "-")],
        ["项目结果", String(a.result ?? "-")]
      ])}
    </div>
  );
}

export function PatentRenderer({ a }: { a: Record<string, unknown> }) {
  const applicants = Array.isArray(a.applicants) ? a.applicants : [];
  return renderPairs([
    ["类型", String(a.patentType === "PATENT" ? "专利" : a.patentType === "SOFTWARE_COPYRIGHT" ? "软件著作权" : "-")],
    ["专利/软著号", String(a.patentNo ?? "-")],
    ["名称", String(a.name ?? "-")],
    ["申请人", applicants.length > 0 ? applicants.join(", ") : "-"],
    ["申请日期", fmtDate(a.applicationDate)],
    ["授权日期", fmtDate(a.grantDate)]
  ]);
}

export function OtherRenderer({ a }: { a: Record<string, unknown> }) {
  return renderPairs([
    ["自由文本", String(a.freeText ?? "-")]
  ]);
}

export function PersonnelCertRenderer({ a }: { a: Record<string, unknown> }) {
  const scanFileId = a.scanFileId as string | undefined;
  return (
    <>
      {renderPairs([
        ["内部员工 ID", String(a.userId ?? "-")],
        ["证书类型", String(a.certificateType ?? "-")],
        ["证书编号", String(a.certificateNo ?? "-")],
        ["颁发机构", String(a.issuingAuthority ?? "-")]
      ])}
      {scanFileId ? (
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            href={`/api/assets/attachments/${scanFileId}/download`}
            target="_blank"
          >
            下载证书扫描件
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: "#999", fontSize: 12 }}>未上传证书扫描件</div>
      )}
    </>
  );
}

export function TemplateRenderer({ a }: { a: Record<string, unknown> }) {
  const templateFileId = a.templateFileId as string | undefined;
  return (
    <>
      {renderPairs([
        ["服务类型", serviceTypeLabel(String(a.serviceType ?? "")) || "通用(全部)"],
        ["模板文件 ID", String(a.templateFileId ?? "-")]
      ])}
      {templateFileId ? (
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            href={`/api/assets/attachments/${templateFileId}/download`}
            target="_blank"
          >
            下载模板文件
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: "#999", fontSize: 12 }}>未上传模板文件</div>
      )}
    </>
  );
}

const RENDERERS: Record<string, (props: { a: Record<string, unknown> }) => React.JSX.Element> = {
  LICENSE: LicenseRenderer,
  CERTIFICATE: CertificateRenderer,
  QUALIFICATION: QualificationRenderer,
  PERFORMANCE: PerformanceRenderer,
  TEAM_MEMBER: TeamMemberRenderer,
  CASE: CaseRenderer,
  PATENT: PatentRenderer,
  OTHER: OtherRenderer,
  // v1 标书素材库新增
  PERSONNEL_CERT: PersonnelCertRenderer,
  TEMPLATE: TemplateRenderer
};

export function AssetAttributesRenderer({ type, attributes }: { type: string; attributes: unknown }) {
  const Cmp = RENDERERS[type];
  if (!Cmp) return <div>未知类型: {type}</div>;
  return <Cmp a={(attributes ?? {}) as Record<string, unknown>} />;
}
