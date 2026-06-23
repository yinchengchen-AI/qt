import { z } from "zod";
import { ROLE_CODES } from "@/types/enums";

const isoDate = z.iso.datetime();

// 字段定义(单点真理,create 和 update 共用)
const announcementFields = {
  title: z.string().min(2, "标题至少 2 个字符").max(200),
  content: z.string().min(1, "内容不能为空").max(10000),
  pinned: z.boolean().default(false),
  effectiveFrom: isoDate.nullish(),
  effectiveTo: isoDate.nullish(),
  targetRoles: z.array(z.enum(ROLE_CODES)).default([])
};

// create: 必填 + refine(生效期止期 ≥ 起期)
export const announcementCreateSchema = z.object(announcementFields).refine(
  (d) => {
    if (!d.effectiveFrom || !d.effectiveTo) return true;
    return new Date(d.effectiveFrom) <= new Date(d.effectiveTo);
  },
  { message: "生效期止期必须晚于或等于起期", path: ["effectiveTo"] }
);

// update: 全 optional,无 refine(避开 Zod v4 不允许在含 refine 的 schema 上 .partial() 的限制)
export const announcementUpdateSchema = z.object({
  title: announcementFields.title.optional(),
  content: announcementFields.content.optional(),
  pinned: announcementFields.pinned.optional(),
  effectiveFrom: announcementFields.effectiveFrom,
  effectiveTo: announcementFields.effectiveTo,
  targetRoles: announcementFields.targetRoles.optional()
});

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;
