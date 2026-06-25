import { z } from "zod";

export const employeeWorkExperienceCreateSchema = z.object({
  profileId: z.string().min(1),
  company: z.string().min(1).max(200),
  position: z.string().max(50).optional().nullable(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime().optional().nullable(),
  leaveReason: z.string().max(200).optional().nullable(),
  referrer: z.string().max(50).optional().nullable(),
  remark: z.string().max(2000).optional().nullable()
});

export const employeeWorkExperienceUpdateSchema = employeeWorkExperienceCreateSchema
  .partial()
  .omit({ profileId: true });

export type EmployeeWorkExperienceCreateInput = z.infer<typeof employeeWorkExperienceCreateSchema>;
export type EmployeeWorkExperienceUpdateInput = z.infer<typeof employeeWorkExperienceUpdateSchema>;
