import { z } from "zod";
import { attachmentUrlSchema, taxRateSchema } from "@/lib/validators/_shared";

const isoDate = z.iso.datetime();

const attachment = z.object({
  id: z.string(),
  name: z.string().min(1),
  // url optional: 新流程存 MinIO objectKey, 下载时实时签 URL
  url: attachmentUrlSchema,
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.string(),
  uploadedAt: z.string()
});

export const invoiceCreateSchema = z.object({
  contractId: z.string().min(1, "请选择合同"),
  // 发票号改为手工录入,不再由系统生成 DRAFT-{timestamp};系统 id 仍保留
  invoiceNo: z.string().min(1, "请填写发票号").max(50, "发票号不超过 50 字"),
  invoiceType: z.enum(["VAT_SPECIAL", "VAT_GENERAL", "VAT_ELECTRONIC", "ELEC_NORMAL"]),
  amount: z.number().positive("金额必须大于 0"),
  taxRate: taxRateSchema.default(0.06),
  applyDate: isoDate,
  expectedIssueDate: isoDate.optional(),
  titleType: z.enum(["COMPANY", "PERSONAL"]),
  titleName: z.string().min(1, "请填写抬头名称").max(100),
  taxNo: z.string().max(30).optional(),
  bankName: z.string().max(50).optional(),
  bankAccount: z.string().max(50).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  remark: z.string().max(500).optional(),
  attachments: z.array(attachment).default([])
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial().extend({
  attachments: z.array(attachment).optional()
});

export const invoiceActionSchema = z.object({
  action: z.enum(["submit", "issue", "reject", "void", "red-flush"]),
  reason: z.string().max(500).optional(),
  invoiceNo: z.string().max(50).optional(),
  actualIssueDate: isoDate.optional()
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;

// 发票列表 query:导出供 use-list-request 反射出 KNOWN_KEYS, 也供 app/api/invoices/route.ts 用
export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
});
