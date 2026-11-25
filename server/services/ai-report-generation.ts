import { z } from "zod";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import type { AnalysisReport } from "@/lib/types/business-report";
import { ERROR_CODES } from "@/types/errors";
import { AI_FEATURE, callAiChat } from "@/server/services/ai-client";
import type { BusinessReportData } from "@/server/services/business-report-data";

export type GenerateReportOptions = {
  userId: string;
  cacheScope: string;
  force?: boolean;
};

const REPORT_SCHEMA = z.object({
  summary: z.string().trim().min(1).max(500),
  keyFindings: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
  recommendations: z.array(z.string().trim().min(1).max(200)).min(1).max(3)
});

const SYSTEM_PROMPT = [
  "你是企业经营分析助手。只能根据给定 JSON 指标输出经营解读。",
  "输出严格 JSON: {\"summary\": string, \"keyFindings\": string[], \"recommendations\": string[]}",
  "summary 一段不超过 300 字; keyFindings 1-4 条; recommendations 1-3 条。",
  "只做定性解释,不计算新指标,不添加编号,不编造客户、员工、事件或原因。",
  "所有数字必须原样使用输入中的数字和单位;数据不足时明确说明,不作预测。"
].join("\n");

function localIsoDate(value?: Date): string | null {
  if (!value) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildBusinessReportPayload(data: BusinessReportData): Record<string, unknown> {
  return {
    统计区间: { 开始: localIsoDate(data.range.from), 结束: localIsoDate(data.range.to) },
    业绩总览: data.overview,
    应收账龄: data.aging,
    月度趋势: data.series ?? []
  };
}

function extractNumbers(value: unknown): Set<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new Set(text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []);
}

export function parseAiReport(
  text: string,
  data: BusinessReportData
): Pick<AnalysisReport, "summary" | "keyFindings" | "recommendations"> {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 输出不含 JSON 对象");
  const parsed = REPORT_SCHEMA.parse(JSON.parse(cleaned.slice(start, end + 1)));
  const allowed = extractNumbers(buildBusinessReportPayload(data));
  for (const value of extractNumbers(JSON.stringify(parsed))) {
    if (!allowed.has(value)) throw new Error(`AI 输出包含输入之外数字: ${value}`);
  }
  return parsed;
}

export function generateLocalSummary(data: BusinessReportData, now = new Date()): AnalysisReport {
  const o = data.overview;
  const a = data.aging;
  const keyFindings = [
    `90+ 天应收 ${a.over90Amount.toFixed(2)} 元，占比 ${a.over90Ratio}%`,
    ...(a.dataQualityExcludedAmount > 0
      ? [`数据质量隔离金额 ${a.dataQualityExcludedAmount.toFixed(2)} 元，不计入当前应收口径`]
      : [])
  ];
  const recommendations = [
    ...(o.paymentRate < 70 ? ["优先跟进已开票未回款合同"] : []),
    ...(a.over90Ratio > 20 ? ["复核 90+ 天应收并制定逐笔跟进计划"] : []),
    ...(a.dataQualityExcludedAmount > 0 ? ["先处理账龄数据质量隔离项"] : [])
  ];

  return {
    summary: `本期合同额 ${o.contractAmount.toFixed(2)} 元，已开票 ${o.invoiceAmount.toFixed(2)} 元，已回款 ${o.paymentAmount.toFixed(2)} 元，回款率 ${o.paymentRate}%`,
    keyFindings,
    recommendations: recommendations.length > 0 ? recommendations : ["保持当前开票与回款跟进节奏"],
    generatedAt: now.toISOString(),
    source: "LOCAL",
    model: null,
    cached: false,
    notice: null
  };
}

export async function generateLLMReport(
  data: BusinessReportData,
  opts: GenerateReportOptions
): Promise<AnalysisReport> {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 报表生成未配置 (DEEPSEEK_API_KEY 未设置)", 503);
  }
  const payload = buildBusinessReportPayload(data);
  const { result, cached, generatedAt } = await callAiChat({
    feature: AI_FEATURE.BUSINESS_REPORT,
    userId: opts.userId,
    cacheScope: opts.cacheScope,
    payload,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `经营指标:\n${JSON.stringify(payload, null, 2)}` }
    ],
    parse: (content) => parseAiReport(content, data),
    force: opts.force
  });

  return {
    ...result,
    generatedAt,
    source: "AI",
    model: env.DEEPSEEK_MODEL,
    cached,
    notice: null
  };
}

export async function generateBusinessReport(
  data: BusinessReportData,
  opts: GenerateReportOptions
): Promise<AnalysisReport> {
  try {
    return await generateLLMReport(data, opts);
  } catch {
    return {
      ...generateLocalSummary(data),
      notice: "AI 解读暂不可用，当前展示规则摘要"
    };
  }
}
