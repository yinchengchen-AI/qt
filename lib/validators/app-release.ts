import { z } from "zod";

// AppRelease 字段定义 (create / update 共用):
//   - version: 必须以 v 开头,例如 v0.7.0,1-50 字符;不再做"自动加 v"归一化,
//     避免历史上 V0.7.0 -> vV0.7.0 这种边角 case,减少一层认知负担
//   - title:   2-200 字符
//   - summary: 1-500 字符 (列表/卡片显示用)
//   - content: 1-10000 字符 (详情使用;支持换行的纯文本/Markdown)
//   - important: 顶部置顶 + 红点;默认 false
//
// git 来源相关的 source/gitFrom/gitTo/gitCommitCount 由创建时的"自动填充"流程写入;
// 不对外暴露成字段,避免 admin 误填。
const appReleaseFields = {
  version: z
    .string()
    .min(1, "版本号不能为空")
    .max(50, "版本号最长 50 字符")
    .regex(/^v\d/, "版本号必须以 v 开头并包含数字,例如 v0.7.0"),
  title: z.string().min(2, "标题至少 2 个字符").max(200),
  summary: z.string().min(1, "概要不能为空").max(500, "概要最长 500 字符"),
  content: z.string().min(1, "详情不能为空").max(10000, "详情最长 10000 字符"),
  important: z.boolean().default(false)
};

export const appReleaseCreateSchema = z.object(appReleaseFields);
export const appReleaseUpdateSchema = z.object({
  version: appReleaseFields.version.optional(),
  title: appReleaseFields.title.optional(),
  summary: appReleaseFields.summary.optional(),
  content: appReleaseFields.content.optional(),
  important: appReleaseFields.important.optional()
  // update 不允许改 source/git*:创建时由自动填充流程决定的元数据
});

export type AppReleaseCreateInput = z.infer<typeof appReleaseCreateSchema>;
export type AppReleaseUpdateInput = z.infer<typeof appReleaseUpdateSchema>;
