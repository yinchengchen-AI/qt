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

/**
 * 增值税适用税率(国内常见档位):
 *   0% / 1% / 3% / 6% / 9% / 13%
 * 0% 用于免税/不征税;1%/3% 多见于小规模纳税人;6%/9%/13% 是现行一般纳税人主档。
 * 之前是 z.number().min(0).max(1) 自由输入, 实操里出现过 0.05 这种"看起来对、算出来错"的脏值,
 * 改 enum 收紧, UI 也同步换成 ProFormSelect。
 */
export const TAX_RATE_OPTIONS = [0, 0.01, 0.03, 0.06, 0.09, 0.13] as const;

export const TAX_RATE_LABELS = TAX_RATE_OPTIONS.map(
  (r) => `${Math.round(r * 100)}%`
);

export function isStandardTaxRate(v: number): boolean {
  return (TAX_RATE_OPTIONS as readonly number[]).includes(v);
}

export const taxRateSchema = z
  .number()
  .refine(isStandardTaxRate, {
    message: `税率必须为 ${TAX_RATE_LABELS.join(" / ")} 之一`
  });

