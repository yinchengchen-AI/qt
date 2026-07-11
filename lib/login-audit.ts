// 登录审计日志 (2026-07-11 hardening)
// 把登录成功 / 失败 / 锁定 / 重置 等安全相关事件写进 OperationLog
// 这样 /api/operation-logs 可以直接展示审计时间线
//
// actorId 取值:
//   - system 用户 (登录失败、token 申请等无身份事件) → SYSTEM_USER_ID ("system")
//   - 登录成功 → 写入该用户自己的 id
//   - 密码重置由 admin 触发 → 写入 admin 用户 id (但当前 API 走 reset-password 脚本,
//     后续 admin API 接入后可改为 admin id)
//
// 设计: 失败/锁定也走 OperationLog 而不是新建一张 LoginAudit 表, 是为了
// 不增加 schema 迁移面 (P0 优先用已有结构, 待真有合规需求再拆分)
import { prisma } from "./prisma";
import { SYSTEM_USER_ID } from "./system";
import { getRequestContext } from "./request-context";

export type LoginAuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAIL"
  | "LOGIN_LOCKED"
  | "LOGIN_RATE_LIMITED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_CONSUMED"
  | "PASSWORD_RESET_INVALID"
  | "PASSWORD_CHANGED";

export type LoginAuditInput = {
  action: LoginAuditAction;
  actorId?: string | null;       // 登录成功时是该用户, 其他场景默认 system
  employeeNo?: string | null;    // 失败/锁定时记录尝试的工号
  ip?: string | null;            // 缺省取 request context
  userAgent?: string | null;
  reason?: string | null;
};

const ENTITY = "Auth";

function pickCtx(providedIp?: string | null, providedUa?: string | null) {
  const ctx = getRequestContext();
  return {
    ip: providedIp ?? ctx?.ip ?? null,
    userAgent: providedUa ?? ctx?.userAgent ?? null,
    requestId: ctx?.requestId,
    method: ctx?.method,
    path: ctx?.path
  };
}

export async function writeLoginAudit(input: LoginAuditInput): Promise<void> {
  const ctx = pickCtx(input.ip, input.userAgent);
  const actorId = input.actorId ?? SYSTEM_USER_ID;

  // entityId: 优先用 employeeNo; 都没有就 "anonymous"
  const entityId = input.employeeNo ?? (input.actorId ?? "anonymous");

  // diff: 仅记录非敏感的"为什么", 绝不写明文密码 / token
  const diff = {
    action: input.action,
    employeeNo: input.employeeNo ?? null,
    reason: input.reason ?? null
  };

  try {
    await prisma.operationLog.create({
      data: {
        actorId,
        entity: ENTITY,
        entityId,
        action: input.action,
        diff: diff as unknown as object,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        status: "SUCCESS"
      }
    });
  } catch (e) {
    // 审计写入失败不应阻塞登录主流程, 但要 console.error 让运维看到
    console.error("[login-audit] failed to write audit log:", e);
  }
}
