import { z } from "zod";
import { ROLE_CODES } from "@/types/enums";

const isoDate = z.iso.datetime();

const baseAnnouncementSchema = z.object({
  title: z.string().min(2, "标题至少 2 个字符").max(200),
  content: z.string().min(1, "内容不能为空").max(10000),
  pinned: z.boolean().default(false),
  effectiveFrom: isoDate.nullish(),
  effectiveTo: isoDate.nullish(),
  targetRoles: z.array(z.enum(ROLE_CODES)).default([])
}).refine(
  (d) => {
    if (!d.effectiveFrom || !d.effectiveTo) return true;
    return new Date(d.effectiveFrom) <= new Date(d.effectiveTo);
  },
  { message: "生效期止期必须晚于或等于起期", path: ["effectiveTo"] }
);

export const announcementCreateSchema = baseAnnouncementSchema;

export const announcementUpdateSchema = baseAnnouncementSchema.partial();

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;
