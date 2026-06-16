import { z } from "zod";

/**
 * 附件 url 字段(历史数据 / 新流程都可能填):
 *  - 新流程: 不带 url(为空或 undefined)
 *  - 老系统迁移: 以 / 开头的相对路径,如 /upload/xxx.pdf
 *  - 其它历史占位: 可能是 https://placeholder.local/... 之类的绝对 URL
 *
 * Zod 4 的 z.string().url() 只认绝对 URL(带 scheme), 会把 /upload/xxx 全部判为非法,
 * 导致编辑老合同 / 老发票时一提交就 400 '数据校验失败'。这里放宽到
 * "绝对 URL 或以 / 开头的相对路径", 让历史假链接也能原样回传。
 */
export const attachmentUrlSchema = z
  .string()
  .refine(
    (v) => v.startsWith("/") || /^https?:\/\//i.test(v),
    "url 必须是绝对 URL(http/https)或以 / 开头的相对路径"
  )
  .optional();
