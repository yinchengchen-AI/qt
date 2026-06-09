import { z } from "zod";

const isoDate = z.iso.datetime();

export const invoiceCreateSchema = z.object({
  projectId: z.string().min(1, "请选择项目"),
  invoiceType: z.enum(["VAT_SPECIAL", "VAT_GENERAL", "VAT_ELECTRONIC", "ELEC_NORMAL"]),
  amount: z.number().positive("金额必须大于 0"),
  taxRate: z.number().min(0).max(1).default(0.06),
  applyDate: isoDate,
  expectedIssueDate: isoDate.optional(),
  titleType: z.enum(["COMPANY", "PERSONAL"]),
  titleName: z.string().min(1, "请填写抬头名称").max(100),
  taxNo: z.string().max(30).optional(),
  bankName: z.string().max(50).optional(),
  bankAccount: z.string().max(50).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  remark: z.string().max(500).optional()
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial();

export const invoiceActionSchema = z.object({
  action: z.enum(["submit", "issue", "reject", "void", "red-flush"]),
  reason: z.string().max(500).optional(),
  invoiceNo: z.string().max(50).optional(),
  actualIssueDate: isoDate.optional()
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;
