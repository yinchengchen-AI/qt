// 前后端统一的日期范围处理。避免 dayjs.toISOString() 带本地时区偏移
// 导致服务端按 UTC 解析后出现边界日期偏移一天的问题。
import type { Dayjs } from "dayjs";

export type DateRange = { from?: Date; to?: Date };

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

/**
 * 把查询字符串里的 from/to 解析成 Date，并校验有效性。
 * 调用方应已经用 Zod 等校验过字段存在性，这里只保证能转成合法 Date。
 */
export function parseDateRangeQuery(params: { from?: string; to?: string }): DateRange {
  const from = params.from ? new Date(params.from) : undefined;
  const to = params.to ? new Date(params.to) : undefined;
  if (from !== undefined && !isValidDate(from)) {
    throw new Error(`无效的日期 from: ${params.from}`);
  }
  if (to !== undefined && !isValidDate(to)) {
    throw new Error(`无效的日期 to: ${params.to}`);
  }
  return { from, to };
}

/**
 * 把 DatePicker 选中的 [Dayjs, Dayjs] 转成传给后端的 query string。
 * 统一取开始日 00:00:00 UTC、结束日 23:59:59.999 UTC，保证语义与界面一致。
 */
export function toDateRangeQuery(range: [Dayjs, Dayjs] | null | undefined): { from?: string; to?: string } {
  if (!range || !range[0] || !range[1]) return {};
  const from = range[0].startOf("day").toISOString();
  const to = range[1].endOf("day").toISOString();
  return { from, to };
}

/**
 * 默认统计区间:本月 1 号 00:00 (本地) ~ 当前时刻。
 * 与 app/api/dashboard/summary/route.ts:monthRange() 语义一致,
 * 避免不同统计页出现 "本月" vs "全期" 行为漂移。
 */
export function defaultMonthRange(): DateRange {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now
  };
}
