import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { writeLoginAudit } from "@/lib/login-audit";
import { issueResetToken, buildResetUrl } from "@/lib/password-reset";
import { ok, ApiError, err } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

// 速率限制: 同 IP 5 分钟最多 5 次 (远低于 login 阈值, 避免重置 token 洪水)
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQ = 5;
const ipBuckets = new Map<string, { ts: number[]; expiresAt: number }>();

function isRateLimited(ip: string, now = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;
  const b = ipBuckets.get(ip);
  const ts = b ? b.ts.filter((t) => t > cutoff) : [];
  return ts.length >= MAX_REQ;
}
function recordHit(ip: string, now = Date.now()): void {
  const cutoff = now - WINDOW_MS;
  const b = ipBuckets.get(ip);
  const ts = b ? b.ts.filter((t) => t > cutoff) : [];
  ts.push(now);
  ipBuckets.set(ip, { ts, expiresAt: now + WINDOW_MS });
}

const RequestSchema = z.object({
  employeeNo: z.string().trim().toLowerCase().min(1).max(64),
  email: z.string().trim().toLowerCase().email().max(254)
});

export async function POST(req: NextRequest) {
  return runWithRequestContext(req, async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请求格式错误", 400);
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "工号或邮箱格式不正确", 400);
    }
    const { employeeNo, email } = parsed.data;

    // IP 限速
    const ctx = (req as NextRequest & { ip?: string }).ip ?? null;
    if (ctx && isRateLimited(ctx)) {
      recordHit(ctx);
      // 仍返回 ok, 但不签发 token; 防探测
      await writeLoginAudit({
        action: "PASSWORD_RESET_REQUESTED",
        employeeNo,
        reason: "rate_limited"
      });
      return ok({ ok: true });
    }
    if (ctx) recordHit(ctx);

    // 校验 employeeNo + email 匹配 + ACTIVE + 非 system
    // 注意: 不存在 / 不匹配也返回 ok, 防枚举
    const user = await prisma.user.findFirst({
      where: {
        employeeNo,
        email,
        deletedAt: null,
        status: "ACTIVE",
        isSystem: false
      },
      select: { id: true, employeeNo: true }
    });

    if (user) {
      const issued = await issueResetToken({
        userId: user.id,
        ip: ctx,
        userAgent: req.headers.get("user-agent")
      });
      const resetUrl = buildResetUrl(issued.token);
      await writeLoginAudit({
        action: "PASSWORD_RESET_REQUESTED",
        actorId: user.id,
        employeeNo,
        reason: "issued"
      });
      // diff 字段给管理员查 OperationLog 时看到完整链接 (一次性原始 token)
      // 仅写一行, 不污染密码哈希 / 用户敏感字段
      await prisma.operationLog
        .create({
          data: {
            actorId: user.id,
            entity: "Auth",
            entityId: user.id,
            action: "PASSWORD_RESET_LINK",
            diff: { url: resetUrl, expiresAt: issued.expiresAt.toISOString() } as unknown as object,
            ip: ctx,
            userAgent: req.headers.get("user-agent"),
            method: "POST",
            path: "/api/auth/password-reset/request",
            status: "SUCCESS"
          }
        })
        .catch((e) => console.error("[password-reset] audit link failed:", e));
    } else {
      await writeLoginAudit({
        action: "PASSWORD_RESET_REQUESTED",
        employeeNo,
        reason: "no_match"
      });
    }

    return ok({ ok: true });
  }).catch((e) => err(e));
}
