import { z } from "zod";
import { ROLE_CODES } from "@/types/enums";

const isoDate = z.iso.datetime();

export const announcementCreateSchema = z.object({
  title: z.string().min(2, "标题至少 2 个字符").max(200),
  content: z.string().min(1, "内容不能为空").max(10000),
  pinned: z.boolean().default(false),
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.optional(),
  targetRoles: z.array(z.enum(ROLE_CODES)).default([])
});

export const announcementUpdateSchema = announcementCreateSchema.partial();

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;
