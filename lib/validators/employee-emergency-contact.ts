import { z } from "zod";

const RELATIONSHIPS = ["父母", "配偶", "兄弟姐妹", "子女", "其他"] as const;
const PHONE_RE = /^1[3-9]\d{9}$/;

export const employeeEmergencyContactCreateSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1).max(50),
  relationship: z.enum(RELATIONSHIPS),
  phone: z.string().regex(PHONE_RE, { message: "手机号格式错误" }),
  remark: z.string().max(500).optional().nullable()
});

export const employeeEmergencyContactUpdateSchema = employeeEmergencyContactCreateSchema
  .partial()
  .omit({ profileId: true });

export type EmployeeEmergencyContactCreateInput = z.infer<typeof employeeEmergencyContactCreateSchema>;
export type EmployeeEmergencyContactUpdateInput = z.infer<typeof employeeEmergencyContactUpdateSchema>;
