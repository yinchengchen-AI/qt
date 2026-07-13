import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { writeLoginAudit } from "@/lib/login-audit";
import { consumeResetToken } from "@/lib/password-reset";
import { ok, ApiError, err } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 12;

const ConfirmSchema = z.object({
  token: z.string().min(8).max(256),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128)
});

export async function POST(req: NextRequest) {
  return runWithRequestContext(req, async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请求格式错误", 400);
    }

    const parsed = ConfirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `token 与新密码均必填, 密码至少 ${MIN_PASSWORD_LENGTH} 字符`,
        400
      );
    }
    const { token, newPassword } = parsed.data;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.headers.get("x-real-ip")
      ?? null;
    const ua = req.headers.get("user-agent");

    // 先 hash 密码, 缩短事务内持锁时间
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    // token 消费 + 写密码在同一事务, 防止并发重复消费同一 token
    const result = await prisma.$transaction(async (tx) => {
      const consumed = await consumeResetToken({ tx, token, ip, userAgent: ua });
      if (!consumed.ok) return consumed;
      await tx.user.update({
        where: { id: consumed.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          lastFailedLoginAt: null
        }
      });
      return consumed;
    });

    if (!result.ok) {
      await writeLoginAudit({
        action: "PASSWORD_RESET_INVALID",
        reason: result.reason
      });
      // 对外统一说 "链接无效或已过期", 不区分 NOT_FOUND / EXPIRED / ALREADY_USED (防探测)
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "重置链接无效或已过期", 400);
    }

    await writeLoginAudit({
      action: "PASSWORD_RESET_CONSUMED",
      actorId: result.userId
    });
    await writeLoginAudit({
      action: "PASSWORD_CHANGED",
      actorId: result.userId
    });

    return ok({ ok: true });
  }).catch((e) => err(e));
}
