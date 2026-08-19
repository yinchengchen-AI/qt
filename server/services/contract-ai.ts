// DeepSeek LLM 合同风险分析 (Phase 4b, spec §7.1 第二层)
//
// 职责: 把 Phase 4a 的结构化风险报告转成自然语言摘要 + 跟进话术。
// 安全 (spec §10): API key 只走 lib/env.ts 服务端读取, 不落库不前端可见;
//   错误信息永不携带 key; 出域数据最小化 — 只发报告字段 (合同号/客户名/金额/评分),
//   不含联系人/电话/证件号等个人敏感字段。
// 降级: 未配置 key → 503 (明确告知未配置, 不伪装本地生成)。
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { ERROR_CODES } from "@/types/errors";
import type { RiskReport } from "@/server/services/contract/risk-report";
import { RISK_DIMENSION_LABELS } from "@/server/services/contract/risk-report";

export type ContractAiAnalysis = {
  summary: string;
  talkTracks: string[];
  model: string;
  generatedAt: string;
};

const TIMEOUT_MS = 20_000;

/** 发送给 LLM 的报告载荷 (出域最小化: 仅业务聚合字段) */
function buildPromptPayload(report: RiskReport, context: {
  customerName: string;
  title: string;
  totalAmount: number;
  paidAmount: number;
  invoicedAmount: number;
  daysOverdue: number;
}) {
  return {
    合同号: report.contractNo,
    客户: context.customerName,
    合同标题: context.title,
    合同总额元: context.totalAmount,
    已回款元: context.paidAmount,
    已开票元: context.invoicedAmount,
    逾期天数: context.daysOverdue,
    风险评分: report.riskScore,
    风险等级: report.riskLevel,
    五维度: Object.fromEntries(
      Object.entries(report.dimensions).map(([k, d]) => [
        RISK_DIMENSION_LABELS[k as keyof typeof RISK_DIMENSION_LABELS] ?? k,
        { 得分: d.score, 说明: d.detail }
      ])
    ),
    规则引擎建议: report.recommendations,
    近30天趋势: report.trendSummary
      ? { 从: report.trendSummary.from, 到: report.trendSummary.to, 主因: RISK_DIMENSION_LABELS[report.trendSummary.mainDriver] }
      : "数据积累中"
  };
}

const SYSTEM_PROMPT = [
  "你是企业合同风险管理助手,服务于一家安全技术服务公司的业务管理系统。",
  "基于给定的合同风险数据 (JSON),输出两部分内容:",
  "1. summary: 一段 100-200 字的风险摘要,点明最关键的一两个风险与依据,语气客观克制,不夸大",
  "2. talkTracks: 2-3 条跟进话术,每条一句可直接发给客户或内部同事的中文短句,务实具体",
  "只基于给定数据,不要编造数据中没有的事实 (如具体项目、人名、历史事件)。",
  "严格输出 JSON: {\"summary\": string, \"talkTracks\": string[]}"
].join("\n");

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
};

/** 从 LLM 文本输出中稳健解析 JSON (容忍 ```json 包裹与首尾杂讯) */
export function parseAiJson(text: string): { summary: string; talkTracks: string[] } {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM 输出不含 JSON 对象");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const talkTracks = Array.isArray(parsed.talkTracks)
    ? parsed.talkTracks.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
    : [];
  if (!summary || talkTracks.length === 0) throw new Error("LLM 输出缺少 summary 或 talkTracks");
  return { summary, talkTracks };
}

export async function analyzeContractRisk(
  report: RiskReport,
  context: {
    customerName: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    invoicedAmount: number;
    daysOverdue: number;
  }
): Promise<ContractAiAnalysis> {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 分析未配置 (DEEPSEEK_API_KEY 未设置)", 503);
  }
  const url = `${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `合同风险数据:\n${JSON.stringify(buildPromptPayload(report, context), null, 2)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    // 网络/超时: 不带任何内部细节给客户端
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `AI 服务请求失败 (${e instanceof Error ? e.name : "network"})`, 502);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 服务鉴权失败 (请检查 DEEPSEEK_API_KEY)", 502);
  }
  if (res.status === 429) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 服务限流中, 请稍后再试", 502);
  }
  if (!res.ok) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `AI 服务异常 (HTTP ${res.status})`, 502);
  }

  const body = (await res.json()) as ChatCompletion;
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 服务返回为空", 502);
  }
  try {
    const parsed = parseAiJson(content);
    return { ...parsed, model: env.DEEPSEEK_MODEL, generatedAt: new Date().toISOString() };
  } catch {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 输出解析失败 (非预期 JSON)", 502);
  }
}
