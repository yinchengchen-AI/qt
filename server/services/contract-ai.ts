// DeepSeek LLM 合同风险分析 (Phase 4b, spec §7.1 第二层)
//
// 职责: 把 Phase 4a 的结构化风险报告转成自然语言摘要 + 跟进话术。
// 本文件只做 prompt 组装与输出解析, 网络调用/结果缓存/用量日志统一走
// server/services/ai-client.ts (callAiChat)。
// 安全 (spec §10): API key 只走 lib/env.ts 服务端读取, 不落库不前端可见;
//   错误信息永不携带 key; 出域数据最小化 — 只发报告字段 (合同号/客户名/金额/评分),
//   不含联系人/电话/证件号等个人敏感字段。
// 降级: 未配置 key → 503 (明确告知未配置, 不伪装本地生成)。
import type { RiskReport } from "@/server/services/contract/risk-report";
import { RISK_DIMENSION_LABELS } from "@/server/services/contract/risk-report";
import { AI_FEATURE, callAiChat } from "@/server/services/ai-client";
import { env } from "@/lib/env";
import { SYSTEM_USER_ID } from "@/lib/system";

export type ContractAiAnalysis = {
  summary: string;
  talkTracks: string[];
  model: string;
  /** true = 命中结果缓存 (未实际调用 LLM) */
  cached: boolean;
  generatedAt: string;
};

/** 发送给 LLM 的报告载荷 (出域最小化: 仅业务聚合字段); 同时是结果缓存的 cacheKey 载荷 */
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
  },
  opts?: {
    /** 调用用户 id, 落 AiUsageLog; 缺省按系统调用记录 */
    userId?: string;
    /** true = 跳过缓存读取 (仍写新缓存), 供前端"重新生成" */
    force?: boolean;
  }
): Promise<ContractAiAnalysis> {
  const payload = buildPromptPayload(report, context);
  const { result, cached, generatedAt } = await callAiChat({
    feature: AI_FEATURE.CONTRACT_RISK_ANALYSIS,
    userId: opts?.userId ?? SYSTEM_USER_ID,
    payload,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `合同风险数据:\n${JSON.stringify(payload, null, 2)}` }
    ],
    parse: parseAiJson,
    force: opts?.force
  });
  return { ...result, model: env.DEEPSEEK_MODEL, cached, generatedAt };
}
