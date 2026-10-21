// 统一 DeepSeek 调用入口: 结果缓存 + 用量日志
//
// 职责:
//   - 所有走 DeepSeek 的功能统一经 callAiChat() 出站, 不再各自裸 fetch
//     (现状仅 contract-ai.ts 一个真实调用方; ai-report-generation / smart-collection 的占位函数不接)。
//   - 结果缓存: cacheKey = sha256(feature + ":" + model + ":" + 规范化 JSON payload),
//     命中未过期缓存直接返回 (AiResponseCache.hitCount++), TTL 24h, 过期 lazy 判定;
//     force=true 跳过读取但仍写新缓存。
//   - 用量日志: 每次调用 (成功 / 失败 / 缓存命中) 写一行 AiUsageLog,
//     成本按下方刊例单价常量估算; requestId 从 AsyncLocalStorage 请求上下文取。
//
// 安全 (spec §10): API key 只在服务端经 lib/env.ts 读取, 错误信息永不携带 key;
//   缓存与日志写库失败只 warn 不阻塞主流程。
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { ERROR_CODES } from "@/types/errors";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";

// feature / status 是 String 列 (项目约定不建 PG enum), 应用层 union 约束
export const AI_FEATURE = {
  CONTRACT_RISK_ANALYSIS: "CONTRACT_RISK_ANALYSIS"
} as const;
export type AiFeature = (typeof AI_FEATURE)[keyof typeof AI_FEATURE];

export const AI_CALL_STATUS = { SUCCESS: "SUCCESS", FAILURE: "FAILURE" } as const;
export type AiCallStatus = (typeof AI_CALL_STATUS)[keyof typeof AI_CALL_STATUS];

// 成本估算口径 (估算用, 非账单依据):
//   deepseek-chat 官方刊例 (deepseek.com 定价页, 2025-02 起长期价):
//   输入 $0.27 / 1M tokens (缓存未命中), 输出 $1.10 / 1M tokens。
//   官方还有缓存命中输入折扣价, 本系统日志无法感知上游缓存, 统一按未命中价估算。
const PRICE_USD_PER_1M_PROMPT_TOKENS = 0.27;
const PRICE_USD_PER_1M_COMPLETION_TOKENS = 1.1;

const TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// errorMessage 入库前截断, 防止超长堆栈/上游响应撑爆行
const ERROR_MESSAGE_MAX = 500;

export type AiChatMessage = { role: "system" | "user"; content: string };

export type CallAiChatParams<T> = {
  feature: AiFeature;
  /** 调用用户 id (落 AiUsageLog.userId); job/脚本场景传 SYSTEM_USER_ID */
  userId: string;
  /** 参与 cacheKey 的业务载荷; 对象 key 会被递归排序, 与 key 书写顺序无关 */
  payload: unknown;
  messages: AiChatMessage[];
  /** 把 LLM 文本输出解析成业务结果; 抛错会被映射为 502 "AI 输出解析失败" */
  parse: (content: string) => T;
  /** 跳过缓存读取 (仍写新缓存与日志), 供"重新生成"使用 */
  force?: boolean;
};

export type AiChatResult<T> = {
  result: T;
  cached: boolean;
  /** 本次生成时间; 缓存命中时为缓存条目生成时间 */
  generatedAt: string;
};

/** 规范化 payload: 对象 key 递归排序, 保证语义相同的书写顺序产生相同的 JSON */
export function normalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizePayload);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, normalizePayload(obj[k])])
    );
  }
  return value;
}

export function computeCacheKey(feature: AiFeature, model: string, payload: unknown): string {
  const canonical = JSON.stringify(normalizePayload(payload));
  return createHash("sha256").update(`${feature}:${model}:${canonical}`).digest("hex");
}

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** 估算单次调用成本 (USD, 6 位小数); tokens 缺失按 0 */
export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  const cost =
    (promptTokens / 1_000_000) * PRICE_USD_PER_1M_PROMPT_TOKENS +
    (completionTokens / 1_000_000) * PRICE_USD_PER_1M_COMPLETION_TOKENS;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

async function safeLog(entry: {
  feature: AiFeature;
  userId: string;
  model: string;
  cacheHit: boolean;
  promptTokens: number;
  completionTokens: number;
  costEstimate: number | null;
  latencyMs: number;
  status: AiCallStatus;
  errorMessage?: string;
}): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        ...entry,
        errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, ERROR_MESSAGE_MAX) : null,
        requestId: getRequestContext()?.requestId ?? null
      }
    });
  } catch (e) {
    console.warn("[ai-client] 用量日志写入失败 (不影响主流程):", e instanceof Error ? e.message : e);
  }
}

/** 统一 AI 调用: 缓存读取 → 计时 fetch → 解析 → 写缓存 + 写日志 */
export async function callAiChat<T>(params: CallAiChatParams<T>): Promise<AiChatResult<T>> {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 分析未配置 (DEEPSEEK_API_KEY 未设置)", 503);
  }
  const model = env.DEEPSEEK_MODEL;
  const cacheKey = computeCacheKey(params.feature, model, params.payload);

  if (!params.force) {
    try {
      const hit = await prisma.aiResponseCache.findUnique({ where: { cacheKey } });
      if (hit && hit.expiresAt.getTime() > Date.now()) {
        // 命中: 计命中次数 + 写 cacheHit 日志 (tokens=0 / cost=null / latency≈0)
        await prisma.aiResponseCache
          .update({ where: { id: hit.id }, data: { hitCount: { increment: 1 } } })
          .catch((e) => console.warn("[ai-client] hitCount 更新失败:", e instanceof Error ? e.message : e));
        await safeLog({
          feature: params.feature,
          userId: params.userId,
          model,
          cacheHit: true,
          promptTokens: 0,
          completionTokens: 0,
          costEstimate: null,
          latencyMs: 0,
          status: AI_CALL_STATUS.SUCCESS
        });
        return { result: hit.response as T, cached: true, generatedAt: hit.createdAt.toISOString() };
      }
    } catch (e) {
      // 缓存读失败不阻塞主流程, 直接走真实调用
      console.warn("[ai-client] 缓存读取失败, 回退真实调用:", e instanceof Error ? e.message : e);
    }
  }

  const startedAt = Date.now();
  const logFailure = async (errorMessage: string) =>
    safeLog({
      feature: params.feature,
      userId: params.userId,
      model,
      cacheHit: false,
      promptTokens: 0,
      completionTokens: 0,
      costEstimate: null,
      latencyMs: Date.now() - startedAt,
      status: AI_CALL_STATUS.FAILURE,
      errorMessage
    });

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
        model,
        messages: params.messages,
        response_format: { type: "json_object" },
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    // 网络/超时: 不带任何内部细节给客户端
    const apiErr = new ApiError(
      ERROR_CODES.INTERNAL_ERROR,
      `AI 服务请求失败 (${e instanceof Error ? e.name : "network"})`,
      502
    );
    await logFailure(apiErr.message);
    throw apiErr;
  }

  const httpError = async (message: string): Promise<never> => {
    await logFailure(message);
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, message, 502);
  };
  if (res.status === 401 || res.status === 403) await httpError("AI 服务鉴权失败 (请检查 DEEPSEEK_API_KEY)");
  if (res.status === 429) await httpError("AI 服务限流中, 请稍后再试");
  if (!res.ok) await httpError(`AI 服务异常 (HTTP ${res.status})`);

  const body = (await res.json()) as ChatCompletion;
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    await logFailure("AI 服务返回为空");
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 服务返回为空", 502);
  }

  let parsed: T;
  try {
    parsed = params.parse(content);
  } catch (e) {
    await logFailure(`AI 输出解析失败 (${e instanceof Error ? e.message : "unknown"})`);
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 输出解析失败 (非预期 JSON)", 502);
  }

  const latencyMs = Date.now() - startedAt;
  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;

  try {
    await prisma.aiResponseCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        feature: params.feature,
        response: parsed as object,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS)
      },
      update: {
        response: parsed as object,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        hitCount: 0
      }
    });
  } catch (e) {
    console.warn("[ai-client] 缓存写入失败 (不影响主流程):", e instanceof Error ? e.message : e);
  }
  await safeLog({
    feature: params.feature,
    userId: params.userId,
    model,
    cacheHit: false,
    promptTokens,
    completionTokens,
    costEstimate: estimateCostUsd(promptTokens, completionTokens),
    latencyMs,
    status: AI_CALL_STATUS.SUCCESS
  });

  return { result: parsed, cached: false, generatedAt: new Date().toISOString() };
}
