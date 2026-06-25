import { z } from "zod";

export const employeeEducationCreateSchema = z.object({
  profileId: z.string().min(1),
  school: z.string().min(1).max(200),
  major: z.string().max(200).optional().nullable(),
  degree: z.string().max(50).optional().nullable(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime().optional().nullable(),
  isFullTime: z.boolean().default(true),
  remark: z.string().max(2000).optional().nullable()
});

export const employeeEducationUpdateSchema = employeeEducationCreateSchema
  .partial()
  .omit({ profileId: true });

export type EmployeeEducationCreateInput = z.infer<typeof employeeEducationCreateSchema>;
export type EmployeeEducationUpdateInput = z.infer<typeof employeeEducationUpdateSchema>;
