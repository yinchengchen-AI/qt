import { z } from "zod";

const isoDate = z.iso.datetime();

export const projectCreateSchema = z.object({
  contractId: z.string().min(1, "请选择合同"),
  name: z.string().min(1, "请输入项目名称").max(100),
  serviceScope: z.string().min(1, "请输入服务范围").max(2000),
  managerUserId: z.string().optional(),
  startDate: isoDate,
  endDate: isoDate
});

export const projectUpdateSchema = projectCreateSchema.partial();

export const projectActionSchema = z.object({
  action: z.enum(["start", "suspend", "resume", "deliver", "accept", "close", "cancel", "progress"]),
  remark: z.string().max(500).optional()
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectActionInput = z.infer<typeof projectActionSchema>;
