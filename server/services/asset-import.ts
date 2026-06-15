// 企业资产库 批量导入
// - parseImportFile: 解析 xlsx → 每行用对应 type 的 Zod schema 校验,聚合错误
// - bulkImportAssets: 事务内批量 create,任一行失败整批回滚
// - generateImportTemplate: 生成 8 个 sheet(每 type 一张),表头由 schema 推导
// - 不引新依赖:用项目现有 ExcelJS
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { assetCreateSchema, type AssetCreateInput } from "@/lib/validators/asset";
import { computeAssetStatus } from "@/lib/assets/status";
import { ASSET_TYPE, type AssetType } from "@/types/enums";
import type { Prisma } from "@prisma/client";

export type ParsedAssetRow = {
  rowIndex: number; // 1-based 表头后第 1 行
  values: Record<string, string>;
  parsed?: AssetCreateInput;
  errors: string[];
};

export type ParseResult = {
  type: AssetType;
  rows: ParsedAssetRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
};

/** 不同 type 需要的列(扁平化,key=属性路径或顶层) */
const COLUMNS: Record<AssetType, string[]> = {
  LICENSE: ["name", "description", "validFrom", "validTo", "tags",
    "unifiedSocialCreditCode", "legalRepresentative", "registeredCapital", "establishDate", "businessScope", "address"],
  CERTIFICATE: ["name", "description", "validFrom", "validTo", "tags",
    "certificateNo", "issuingAuthority", "gradeLevel", "category"],
  QUALIFICATION: ["name", "description", "validFrom", "validTo", "tags",
    "standard", "certificateNo", "issuingAuthority", "scope"],
  PERFORMANCE: ["name", "description", "validFrom", "validTo", "tags",
    "projectName", "customerName", "customerContact", "serviceType", "contractAmount", "signDate", "completedDate", "contractId"],
  TEAM_MEMBER: ["name", "description", "tags",
    "userId", "externalName", "externalPhone", "title", "specialty", "yearsOfExperience", "resumeMarkdown"],
  CASE: ["name", "description", "tags",
    "title", "customerName", "serviceType", "year", "scope", "highlights", "result", "projectId"],
  PATENT: ["name", "description", "validFrom", "validTo", "tags",
    "patentType", "patentNo", "name", "applicants", "applicationDate", "grantDate"],
  OTHER: ["name", "description", "validFrom", "validTo", "tags", "freeText"]
};

/** 把扁平行转成 AssetCreateInput 形状(type 强校验) */
function rowToInput(type: AssetType, values: Record<string, string>): Record<string, unknown> {
  const tags = (values.tags ?? "").split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
  const common = {
    name: values.name?.trim(),
    description: values.description?.trim() || undefined,
    tags,
    validFrom: values.validFrom?.trim() || undefined,
    validTo: values.validTo?.trim() || undefined
  };
  switch (type) {
    case "LICENSE":
      return {
        type, ...common,
        attributes: {
          unifiedSocialCreditCode: values.unifiedSocialCreditCode,
          legalRepresentative: values.legalRepresentative,
          registeredCapital: values.registeredCapital,
          establishDate: values.establishDate,
          businessScope: values.businessScope,
          address: values.address
        }
      };
    case "CERTIFICATE":
      return {
        type, ...common,
        attributes: {
          certificateNo: values.certificateNo,
          issuingAuthority: values.issuingAuthority,
          gradeLevel: values.gradeLevel || undefined,
          category: values.category
        }
      };
    case "QUALIFICATION":
      return {
        type, ...common,
        attributes: {
          standard: values.standard,
          certificateNo: values.certificateNo,
          issuingAuthority: values.issuingAuthority,
          scope: values.scope || undefined
        }
      };
    case "PERFORMANCE":
      return {
        type, ...common,
        attributes: {
          projectName: values.projectName,
          customerName: values.customerName,
          customerContact: values.customerContact || undefined,
          serviceType: values.serviceType,
          contractAmount: values.contractAmount ? Number(values.contractAmount) : undefined,
          signDate: values.signDate || undefined,
          completedDate: values.completedDate || undefined,
          contractId: values.contractId || undefined
        }
      };
    case "TEAM_MEMBER":
      return {
        type,
        name: common.name, description: common.description, tags: common.tags,
        attributes: {
          userId: values.userId || undefined,
          externalName: values.externalName || undefined,
          externalPhone: values.externalPhone || undefined,
          title: values.title,
          specialty: values.specialty,
          yearsOfExperience: values.yearsOfExperience ? Number(values.yearsOfExperience) : 0,
          certificates: [],
          resumeMarkdown: values.resumeMarkdown || undefined
        }
      };
    case "CASE":
      return {
        type, name: common.name, description: common.description, tags: common.tags,
        attributes: {
          projectId: values.projectId || undefined,
          title: values.title,
          customerName: values.customerName,
          serviceType: values.serviceType,
          year: values.year ? Number(values.year) : undefined,
          scope: values.scope,
          highlights: values.highlights || undefined,
          result: values.result || undefined
        }
      };
    case "PATENT":
      return {
        type, ...common,
        attributes: {
          patentType: values.patentType,
          patentNo: values.patentNo,
          name: values.name ?? values["patentName"],
          applicants: values.applicants ? values.applicants.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean) : [],
          applicationDate: values.applicationDate,
          grantDate: values.grantDate || undefined
        }
      };
    case "OTHER":
      return {
        type, ...common,
        attributes: { freeText: values.freeText || undefined }
      };
  }
}

/** 解析上传的 xlsx,转成 row 列表 + 错误 */
export async function parseImportFile(
  user: SessionUser,
  type: AssetType,
  buffer: ArrayBuffer | Buffer
): Promise<ParseResult> {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.CREATE);
  if (!ASSET_TYPE.includes(type)) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知资产类型", 400);
  const wb = new ExcelJS.Workbook();
  // ExcelJS 接受 Buffer:把 ArrayBuffer 转成 Buffer
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { type, rows: [], totalRows: 0, validCount: 0, errorCount: 0 };
  // 第一行是表头
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });
  const rows: ParsedAssetRow[] = [];
  let validCount = 0;
  let errorCount = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const values: Record<string, string> = {};
    for (let i = 1; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const v = row.getCell(i).value;
      values[key] = v == null ? "" : String(v).trim();
    }
    const candidate = rowToInput(type, values);
    const result = assetCreateSchema.safeParse(candidate);
    const errors: string[] = [];
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        errors.push(`${path}: ${issue.message}`);
      }
      errorCount++;
    } else {
      validCount++;
    }
    rows.push({
      rowIndex: rowNumber,
      values,
      parsed: result.success ? result.data : undefined,
      errors
    });
  });
  return {
    type,
    rows,
    totalRows: rows.length,
    validCount,
    errorCount
  };
}

/** 事务内批量入库(任一行失败整批回滚) */
export async function bulkImportAssets(
  user: SessionUser,
  type: AssetType,
  rows: AssetCreateInput[]
) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.CREATE);
  if (!rows.length) return { inserted: 0, ids: [] as string[] };
  const now = new Date();
  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      // 二次校验
      const data = assetCreateSchema.parse(row);
      const code = await nextBusinessNo("ASSET");
      const status = computeAssetStatus(data.validFrom, data.validTo, now);
      const asset = await tx.companyAsset.create({
        data: {
          code,
          type: data.type,
          name: data.name,
          description: data.description || null,
          attributes: data.attributes as Prisma.InputJsonValue,
          tags: data.tags ?? [],
          status,
          validFrom: data.validFrom ? new Date(data.validFrom) : null,
          validTo: data.validTo ? new Date(data.validTo) : null,
          ownerUserId: user.id
        }
      });
      created.push(asset.id);
    }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_BULK_IMPORT",
    entity: "CompanyAsset",
    entityId: "bulk",
    after: { type, count: created.length, ids: created.slice(0, 50) }
  });
  return { inserted: created.length, ids: created };
}

/** 生成 8 sheet 模板(用于下载) */
export async function generateImportTemplate(_user: SessionUser, type: AssetType): Promise<Buffer> {
  if (!ASSET_TYPE.includes(type)) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知资产类型", 400);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type);
  const cols = COLUMNS[type];
  // 表头中文
  const HEADER_CN: Record<string, string> = {
    name: "资产名称 *", description: "说明", validFrom: "生效日期(ISO)", validTo: "到期日期(ISO)", tags: "标签(逗号分隔)",
    unifiedSocialCreditCode: "统一社会信用代码 *", legalRepresentative: "法定代表人 *", registeredCapital: "注册资本 *",
    establishDate: "成立日期(ISO) *", businessScope: "经营范围 *", address: "注册地址 *",
    certificateNo: "证书编号 *", issuingAuthority: "颁发机构 *", gradeLevel: "等级(甲/乙/丙)", category: "资质类别 *",
    standard: "标准(ISO9001/14001/45001/27001/50001/OTHER) *", scope: "认证范围",
    projectName: "项目名称 *", customerName: "客户名称 *", customerContact: "客户联系方式",
    serviceType: "服务类型 *", contractAmount: "合同金额", signDate: "签订日期(ISO)", completedDate: "完成日期(ISO)", contractId: "关联合同ID",
    userId: "内部员工ID", externalName: "外部姓名", externalPhone: "外部电话",
    title: "职称/案例标题 *", specialty: "专业方向 *", yearsOfExperience: "从业年限 *", resumeMarkdown: "简历(Markdown)",
    year: "年份 *", highlights: "项目亮点", result: "项目结果", projectId: "关联项目ID",
    patentType: "类型(PATENT/SOFTWARE_COPYRIGHT) *", patentNo: "专利/软著号 *", applicants: "申请人(逗号分隔) *",
    applicationDate: "申请日期(ISO) *", grantDate: "授权日期(ISO)",
    freeText: "自由文本"
  };
  ws.columns = cols.map((c) => ({ header: HEADER_CN[c] ?? c, key: c, width: 24 }));
  ws.getRow(1).font = { bold: true };
  // 1 行示例(让用户能看格式)
  const sample = sampleRow(type);
  if (sample) ws.addRow(sample);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function sampleRow(type: AssetType): Record<string, string> | null {
  switch (type) {
    case "LICENSE":
      return {
        name: "示例:杭州企泰安全科技有限公司营业执照",
        unifiedSocialCreditCode: "91330100MA00000000",
        legalRepresentative: "张三",
        registeredCapital: "1000万",
        establishDate: "2020-01-01T00:00:00Z",
        businessScope: "安全咨询服务;安全培训;检测服务",
        address: "浙江省杭州市西湖区文三路 1 号",
        validFrom: "2020-01-01T00:00:00Z",
        validTo: "2030-12-31T00:00:00Z",
        tags: "示例"
      };
    case "CERTIFICATE":
      return {
        name: "示例:安全评价机构资质证书",
        certificateNo: "AP-2020-0001",
        issuingAuthority: "应急管理部",
        gradeLevel: "甲级",
        category: "安全评价",
        validFrom: "2020-06-01T00:00:00Z",
        validTo: "2026-06-01T00:00:00Z",
        tags: "示例,资质"
      };
    default:
      return null;
  }
}
