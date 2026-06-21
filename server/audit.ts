// 操作日志工具：在事务内 tx.create operationLog；保留 5 年
// OperationLog 模型字段：actorId / entity / entityId / action / diff(Json) / ip / at
//                    + userAgent / requestId / method / path / status / errorMessage
//
// 设计要点：
//   - 自动从 AsyncLocalStorage (lib/request-context) 读取 IP/UA/requestId/method/path。
//     service 层调用 audit() 时无需手动塞入，由上游 runWithRequestContext 注入。
//   - 调用方仍可显式覆盖 input.ip / input.userAgent（保持向后兼容）。
//   - 拿不到 ctx 时（脚本 / 单元测试 / 后台 job） 新字段为 null，不影响主流程。
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { getRequestContext } from "@/lib/request-context";

type AuditInput = {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** 显式传入会覆盖 ctx 中的 IP；通常不需要 */
  ip?: string;
  /** 显式传入会覆盖 ctx 中的 UA；通常不需要 */
  userAgent?: string;
  /** 执行结果状态，默认 SUCCESS；记录失败调用时可传 FAILURE */
  status?: "SUCCESS" | "FAILURE";
  /** 失败时的错误描述（仅 status=FAILURE 时使用） */
  errorMessage?: string;
};

// 敏感字段脱敏：永不入 OperationLog.diff
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "bankAccount",
  "bankRefNo",
  "taxNo",
  "unifiedSocialCreditCode",
  "idCard",
  "cardNo",
  "wechatWorkId",
  "phone",
  "contactPhone",
  "email",
]);
function redact<T>(v: T): T {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(redact) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "***REDACTED***" : redact(val);
  }
  return out as T;
}

// AUDIT_FULL_PAYLOAD=false 时,before/after 只保留字段名(用于知道改了哪些字段),不存值
// 高敏部署可关闭以减少 PII 暴露面;默认 true 保持行为不变
const FULL_PAYLOAD =
  (process.env.AUDIT_FULL_PAYLOAD ?? "true").toLowerCase() !== "false";
function stripValues<T>(v: T): T {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v))
    return v.map(() => ({} as Record<string, unknown>)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) out[k] = "<redacted>";
  return out as T;
}

export async function audit(tx: Prisma.TransactionClient, input: AuditInput) {
  // diff 字段：合并 before/after 为单 JSON；若都没有则 null
  const b = input.before;
  const a = input.after;
  const bOut = b !== undefined ? (FULL_PAYLOAD ? redact(b) : stripValues(b)) : null;
  const aOut = a !== undefined ? (FULL_PAYLOAD ? redact(a) : stripValues(a)) : null;
  const diff =
    b !== undefined || a !== undefined
      ? { before: bOut, after: aOut }
      : PrismaNS.JsonNull;

  // 请求上下文（API 路由 / 同步脚本能透传 IP/UA/requestId/method/path）
  // 调用方显式传入的 ip / userAgent 优先级高于 ctx
  const ctx = getRequestContext();

  return tx.operationLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      diff: diff as Prisma.InputJsonValue,
      ip: input.ip ?? ctx?.ip ?? null,
      userAgent: input.userAgent ?? ctx?.userAgent ?? null,
      requestId: ctx?.requestId ?? null,
      method: ctx?.method ?? null,
      path: ctx?.path ?? null,
      status: input.status ?? "SUCCESS",
      errorMessage: input.errorMessage ?? null,
    },
  });
}

export async function auditUpdate<T extends Record<string, unknown>>(
  tx: Prisma.TransactionClient,
  args: {
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    before: T;
    after: T;
  },
) {
  return audit(tx, {
    actorId: args.actorId,
    action: args.action,
    entity: args.entity,
    entityId: args.entityId,
    before: args.before,
    after: args.after,
  });
}
