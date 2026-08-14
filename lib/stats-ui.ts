// 统计分析模块共享常量与工具
// 供 statistics 各页面(performance / overview / aging)复用,避免阈值、色板、
// 排名样式与比率计算在多个页面重复定义导致漂移。

/** 开票率 Tag 颜色阈值(百分比) */
export const INVOICE_RATE_THRESHOLDS = { green: 70, blue: 40 } as const;
/** 回款率 Tag 颜色阈值(百分比) */
export const PAYMENT_RATE_THRESHOLDS = { green: 80, blue: 50 } as const;

/** 根据比率值与阈值返回 Tag 语义色: ≥green 绿, ≥blue 蓝, 否则橙 */
export function rateTagColor(
  rate: number,
  thresholds: { green: number; blue: number }
): "green" | "blue" | "orange" {
  return rate >= thresholds.green ? "green" : rate >= thresholds.blue ? "blue" : "orange";
}

/** 排行榜前三名 emoji(0 起索引) */
export function rankEmoji(i: number): string {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "";
}

/** 分类色板:员工/区域排行柱状图共用。同一实体跨指标保持同色,不同实体颜色不同。
 *  已用 dataviz skill 的 validate_palette.js 在 light 表面验证通过(CVD ≥ 12, labels 提供 relief)。 */
export const CATEGORICAL_COLORS = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
  "#13c2c2", // cyan
  "#1890ff", // antd blue
] as const;

/** 账龄桶 */
export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];
export const AGING_BUCKET_COLORS: Record<AgingBucket, string> = {
  "0-30": "#52c41a",
  "31-60": "#1677ff",
  "61-90": "#faad14",
  "90+": "#ff4d4f",
};

/** 计算开票率/回款率(百分比)。与 server 端 computeRowRates 同口径: contract=0 开票率 0, invoice=0 回款率 0 */
export function calcRates(contract: number, invoice: number, payment: number): {
  invoiceRate: number;
  paymentRate: number;
} {
  const invoiceRate = contract > 0 ? (invoice / contract) * 100 : 0;
  const paymentRate = invoice > 0 ? (payment / invoice) * 100 : 0;
  return { invoiceRate, paymentRate };
}