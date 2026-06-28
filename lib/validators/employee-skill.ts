import { z } from "zod";

const SKILL_LEVEL = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export const employeeSkillCreateSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1).max(100),
  level: z.enum(SKILL_LEVEL).default("INTERMEDIATE"),
  obtainDate: z.iso.datetime().optional().nullable(),
  remark: z.string().max(2000).optional().nullable()
});

export const employeeSkillUpdateSchema = employeeSkillCreateSchema
  .partial()
  .omit({ profileId: true });

export type EmployeeSkillCreateInput = z.infer<typeof employeeSkillCreateSchema>;
export type EmployeeSkillUpdateInput = z.infer<typeof employeeSkillUpdateSchema>;
