// 密码重置 token 业务封装 (2026-07-11 hardening)
// token 设计:
//   - 生成: crypto.randomBytes(32).toString("base64url") (43 字符)
//   - 存: 仅存 SHA-256(token) (tokenHash 字段); 原始 token 只在 issue() 返回
//   - 用: 一次性消费, usedAt 置非空; 重复消费被拒
//   - 过期: 默认 30 分钟
//
// 提交流程 (无邮件基础设施):
//   1. 前端提交 (employeeNo, email) → /api/auth/password-reset/request
//   2. 后端验证 (employeeNo, email) 匹配 ACTIVE 用户
//   3. 签发 token, 返回 { ok: true } (不返回 token, 也不把 token/URL 写入审计日志)
//   4. 同步写 OperationLog 记录元数据(签发时间、IP), 供审计追踪
//   5. 管理员在需要时通过 /admin/users 的"重置密码"功能直接帮用户设新密码
//   6. 若用户持有有效链接,可点击 /login?resetToken=xxx 进入改密页面
//   7. confirm 接口校验 token + 写新密码 + 置 usedAt + audit
//
// 安全原则: 原始 token 仅在 issue() 返回, 不落地、不日志、不返回给前端。
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 分钟

export type IssuedResetToken = {
  token: string;        // 原始 token (一次性, 仅在 issue 时返回)
  tokenHash: string;    // SHA-256(token)
  expiresAt: Date;
};

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): string {
  // 32 bytes → 43 字符 base64url (无 padding)
  return randomBytes(32).toString("base64url");
}

/** 签发并落库; 不去重旧的 (旧 token 仍在 expiresAt 内, 仍有效) */
export async function issueResetToken(params: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<IssuedResetToken> {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      requestedIp: params.ip ?? null,
      requestedUserAgent: params.userAgent ?? null
    }
  });

  return { token, tokenHash, expiresAt };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "ALREADY_USED" };

/**
 * 消费 token; 必须传入事务客户端, 与改密码在同一事务内完成。
 * 用 updateMany + 条件(未使用且未过期)实现原子"抢锁", 避免并发下同一 token 被重复消费。
 */
export async function consumeResetToken(params: {
  tx: Prisma.TransactionClient;
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ConsumeResult> {
  const tokenHash = hashResetToken(params.token);
  const now = new Date();

  // 原子标记消费: 只有未使用且未过期的行才会被更新; 并发时只有一个事务能成功
  const updated = await params.tx.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: {
      usedAt: now,
      consumedIp: params.ip ?? null,
      consumedUserAgent: params.userAgent ?? null,
    },
  });

  if (updated.count === 0) {
    // 更新失败, 区分具体原因(仍不对外暴露, 仅内部日志/审计用)
    const row = await params.tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!row) return { ok: false, reason: "NOT_FOUND" };
    if (row.usedAt) return { ok: false, reason: "ALREADY_USED" };
    if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "EXPIRED" };
    return { ok: false, reason: "ALREADY_USED" };
  }

  const row = await params.tx.passwordResetToken.findUniqueOrThrow({
    where: { tokenHash },
    select: { userId: true },
  });
  return { ok: true, userId: row.userId };
}

/** 拼出完整的重置 URL, 供 OperationLog.diff 记录 (admin 可在 /api/operation-logs 查到) */
export function buildResetUrl(rawToken: string): string {
  const base = (env.APP_PUBLIC_URL ?? env.NEXTAUTH_URL ?? "http://localhost:3000")
    .replace(/\/+$/, "");
  return `${base}/login?resetToken=${encodeURIComponent(rawToken)}`;
}
