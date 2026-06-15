// 企业资产库 Zod 校验
// - 8 种 type 走 discriminatedUnion,前端 ProForm 用 values.type 切字段
// - 顶层 refine 校验 validTo >= validFrom(放在 union 之后,跟 contract 风格一致)
// - 属性代码(统社代码 / 资质编号等)在 type-specific schema 内分别校验
import { z } from "zod";
import { ASSET_TYPE, ASSET_STATUS, SERVICE_TYPE } from "@/types/enums";
import { isValidCreditCode } from "@/lib/credit-code";

// 通用字段(name/description/tags/有效期)
const baseFields = {
  name: z.string().min(1, "资产名称必填").max(100),
  description: z.string().max(2000).optional().or(z.literal("")),
  tags: z.array(z.string().min(1).max(20)).max(20).default([]),
  validFrom: z.iso.datetime().optional().or(z.literal("")),
  validTo: z.iso.datetime().optional().or(z.literal(""))
};

// 1. 营业执照
const LicenseAttrs = z.object({
  unifiedSocialCreditCode: z
    .string()
    .min(1, "统一社会信用代码必填")
    .refine(isValidCreditCode, { message: "统一社会信用代码格式错误" }),
  legalRepresentative: z.string().min(1, "法定代表人必填").max(50),
  registeredCapital: z.string().min(1, "注册资本必填").max(50),
  establishDate: z.iso.datetime({ message: "成立日期格式错误(ISO)" }),
  businessScope: z.string().min(1, "经营范围必填").max(2000),
  address: z.string().min(1, "注册地址必填").max(200)
});

// 2. 资质证书
const CertificateAttrs = z.object({
  certificateNo: z.string().min(1, "证书编号必填").max(80),
  issuingAuthority: z.string().min(1, "颁发机构必填").max(100),
  gradeLevel: z.enum(["甲级", "乙级", "丙级"]).optional(),
  category: z.string().min(1, "资质类别必填").max(80)
});

// 3. 认证体系(ISO 等)
const QualificationAttrs = z.object({
  standard: z.enum(["ISO9001", "ISO14001", "ISO45001", "ISO27001", "ISO50001", "OTHER"]),
  certificateNo: z.string().min(1, "证书编号必填").max(80),
  issuingAuthority: z.string().min(1, "认证机构必填").max(100),
  scope: z.string().max(2000).optional().or(z.literal(""))
});

// 4. 业绩证明
const PerformanceAttrs = z.object({
  projectName: z.string().min(1, "项目名称必填").max(200),
  // 客户名称允许从客户 picker 自动回填,故 v1 仍需必填(回填后即有值)
  customerName: z.string().min(1, "客户名称必填").max(200),
  customerContact: z.string().max(100).optional().or(z.literal("")),
  customerId: z.string().optional(),                // 关联客户 ID(从 picker 写入)
  serviceType: z.string().min(1),  // 兼容 LEGACY-*
  contractAmount: z.number().nonnegative("合同金额不能为负").optional(),
  signDate: z.iso.datetime().optional().or(z.literal("")),
  completedDate: z.iso.datetime().optional().or(z.literal("")),
  contractId: z.string().optional()                 // 关联合同 ID
});

// 5. 团队成员
const MemberCert = z.object({
  name: z.string().min(1).max(80),
  no: z.string().max(80).optional(),
  validTo: z.iso.datetime().optional().or(z.literal(""))
});

const TeamMemberAttrs = z
  .object({
    userId: z.string().optional(),
    externalName: z.string().max(50).optional(),
    externalPhone: z.string().max(20).optional(),
    title: z.string().min(1, "职称/职务必填").max(50),
    specialty: z.string().min(1, "专业方向必填").max(200),
    yearsOfExperience: z.number().int().nonnegative("从业年限不能为负"),
    certificates: z.array(MemberCert).default([]),
    resumeMarkdown: z.string().max(20000).optional().or(z.literal(""))
  })
  .refine((v) => Boolean(v.userId) || Boolean(v.externalName), {
    message: "内部 userId 与外部姓名至少二选一",
    path: ["externalName"]
  });

// 6. 项目案例
const CaseAttrs = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1, "案例标题必填").max(200),
  customerName: z.string().min(1, "客户名称必填").max(200),
  serviceType: z.string().min(1),  // 兼容 LEGACY-*
  year: z.number().int().min(2000).max(2100),
  scope: z.string().min(1, "项目内容必填").max(2000),
  highlights: z.string().max(5000).optional().or(z.literal("")),
  result: z.string().max(2000).optional().or(z.literal(""))
});

// 7. 专利软著
const PatentAttrs = z.object({
  patentType: z.enum(["PATENT", "SOFTWARE_COPYRIGHT"]),
  patentNo: z.string().min(1, "专利/软著号必填").max(80),
  name: z.string().min(1, "名称必填").max(200),
  applicants: z.array(z.string().min(1).max(100)).min(1, "申请人至少 1 个"),
  applicationDate: z.iso.datetime({ message: "申请日期格式错误" }),
  grantDate: z.iso.datetime().optional().or(z.literal(""))
});

// 8. 其他
const OtherAttrs = z.object({
  freeText: z.string().max(5000).optional().or(z.literal(""))
});

export const assetCreateSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("LICENSE"), ...baseFields, attributes: LicenseAttrs }),
    z.object({ type: z.literal("CERTIFICATE"), ...baseFields, attributes: CertificateAttrs }),
    z.object({ type: z.literal("QUALIFICATION"), ...baseFields, attributes: QualificationAttrs }),
    z.object({ type: z.literal("PERFORMANCE"), ...baseFields, attributes: PerformanceAttrs }),
    z.object({ type: z.literal("TEAM_MEMBER"), ...baseFields, attributes: TeamMemberAttrs }),
    z.object({ type: z.literal("CASE"), ...baseFields, attributes: CaseAttrs }),
    z.object({ type: z.literal("PATENT"), ...baseFields, attributes: PatentAttrs }),
    z.object({ type: z.literal("OTHER"), ...baseFields, attributes: OtherAttrs })
  ])
  .refine(
    (v) => {
      if (!v.validFrom || !v.validTo) return true;
      return new Date(v.validTo) >= new Date(v.validFrom);
    },
    { message: "validTo 不能早于 validFrom", path: ["validTo"] }
  );

// update schema:type 不可改,attributes 在 service 层按 type 单独 validate
// PATCH 语义:所有字段可选,attributes 不传时保留原值
export const assetUpdateSchema = z
  .object({
    name: baseFields.name.optional(),
    description: baseFields.description,
    tags: baseFields.tags.optional(),
    validFrom: baseFields.validFrom,
    validTo: baseFields.validTo,
    attributes: z.record(z.string(), z.unknown()).optional()
  })
  .refine(
    (v) => {
      if (!v.validFrom || !v.validTo) return true;
      return new Date(v.validTo) >= new Date(v.validFrom);
    },
    { message: "validTo 不能早于 validFrom", path: ["validTo"] }
  );

export const assetListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(ASSET_TYPE).optional(),
  status: z.enum(ASSET_STATUS).optional(),
  q: z.string().optional(),
  tags: z.string().optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  includeArchived: z.coerce.boolean().default(false)
});

export type AssetCreateInput = z.infer<typeof assetCreateSchema>;
export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;
