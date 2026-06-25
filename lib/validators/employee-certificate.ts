import { z } from "zod";

// 基础字段(不含 refine)单独定义,这样 update schema 才能用 .partial()
const baseFields = {
  profileId: z.string().min(1),
  name: z.string().min(1).max(200),
  number: z.string().max(100).optional().nullable(),
  issuer: z.string().max(200).optional().nullable(),
  issueDate: z.iso.datetime().optional().nullable(),
  expiryDate: z.iso.datetime().optional().nullable(),
  attachmentId: z.string().min(1).optional().nullable(),
  remark: z.string().max(2000).optional().nullable()
};

export const employeeCertificateCreateSchema = z.object(baseFields).refine(
  (v) => !v.issueDate || !v.expiryDate || new Date(v.issueDate) <= new Date(v.expiryDate),
  { message: "颁发日期不能晚于到期日期", path: ["expiryDate"] }
);

export const employeeCertificateUpdateSchema = z.object(baseFields).partial().omit({ profileId: true });

export type EmployeeCertificateCreateInput = z.infer<typeof employeeCertificateCreateSchema>;
export type EmployeeCertificateUpdateInput = z.infer<typeof employeeCertificateUpdateSchema>;
