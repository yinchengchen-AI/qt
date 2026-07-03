import { z } from "zod";

// 字段定义(单点真理,create 和 update 共用)
// - version: 形如 "v0.7.0",最多 50 字符(放 Varchar(50) 范围内)。
//   允许 "0.7.0" 不带 v,前端 UI 不强制;但至少要含数字。
// - title: 跟 Announcement 对齐,2-200。
// - summary: 1-500 字符(列表/卡片展示用)。
// - content: 1-10000 字符(弹窗/详情用,支持换行的纯文本/Markdown)。
// - important: 是否加红点/置顶;默认 false。
//
// 自动生成相关(2026-07 起,scripts/release/generate.ts 自动从 git log 生成):
// - source: MANUAL (旧数据/手敲) | GIT_COMMITS (从 git 自动生成)
// - gitFrom / gitTo: 覆盖的 commit 区间(SHA 短/长均可,VarChar(40) 覆盖 SHA-1)
// - gitCommitCount: 该 release 覆盖的 commit 数(列表展示"基于 N 个 commit")
const SOURCE_VALUES = ["MANUAL", "GIT_COMMITS"] as const;

const appReleaseFields = {
  // M-1: 归一化版本号,确保带 v 前缀
  //   之前允许 "v0.7.0" 和 "0.7.0" 两种写法,会导致同版本被创建两次
  //   (不同字符串,unique 检查 / 查重都过)。transform 在校验后跑,产物
  //   一定带 v 前缀,DB 查重也走归一化后的字符串。
  version: z
    .string()
    .min(1, "版本号不能为空")
    .max(50, "版本号最多 50 字符")
    .regex(/\d/, "版本号需包含数字")
    .transform((v) => (v.startsWith("v") ? v : `v${v}`)),
  title: z.string().min(2, "标题至少 2 个字符").max(200),
  summary: z.string().min(1, "概要不能为空").max(500, "概要最多 500 字符"),
  content: z.string().min(1, "详情不能为空").max(10000, "详情最多 10000 字符"),
  important: z.boolean().default(false),
  source: z.enum(SOURCE_VALUES).default("MANUAL"),
  gitFrom: z.string().min(7, "gitFrom 至少 7 字符(SHA 短码)").max(40).optional(),
  gitTo: z.string().min(7, "gitTo 至少 7 字符(SHA 短码)").max(40).optional(),
  gitCommitCount: z.number().int().min(0).max(10000).optional()
};

export const appReleaseCreateSchema = z.object(appReleaseFields);
export const appReleaseUpdateSchema = z.object({
  version: appReleaseFields.version.optional(),
  title: appReleaseFields.title.optional(),
  summary: appReleaseFields.summary.optional(),
  content: appReleaseFields.content.optional(),
  important: appReleaseFields.important.optional(),
  // update 不允许改 source/git*;这些是创建时的元数据,改它们没意义
  // 想"重新生成"请先删旧的再创建新的
});

export type AppReleaseCreateInput = z.infer<typeof appReleaseCreateSchema>;
export type AppReleaseUpdateInput = z.infer<typeof appReleaseUpdateSchema>;
export type AppReleaseSource = (typeof SOURCE_VALUES)[number];
