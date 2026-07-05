import { encode } from "next-auth/jwt";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { env } from '@/lib/env';
import type { RoleCode } from '@/types/enums';
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { audit } from "@/server/audit";

const COOKIE_NAME_DEV = "next-auth.session-token";
const COOKIE_NAME_PROD = "__Secure-next-auth.session-token";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

async function loadActiveUser(uid: string) {
  return prisma.user.findFirst({
    where: { id: uid, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: { id: true, employeeNo: true, name: true, role: { select: { code: true } } },
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { state?: string };
    const state = body.state;
    if (!state) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));

    const row = await prisma.dingtalkLoginCode.findUnique({ where: { state } });
    if (!row) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));
    if (Date.now() > row.expiresAt.getTime()) {
      return err(new ApiError(ERROR_CODES.DINGTALK_QR_EXPIRED, undefined, 410));
    }
    if (row.status === "CONSUMED") {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_CONSUMED, undefined, 409));
    }
    if (row.status !== "READY") {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_READY, undefined, 409));
    }
    if (!row.unionid || !row.mobile) {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_READY, undefined, 409));
    }

    // 1) Resolve target user: by existing identity, else by mobile match
    let userId: string | null = null;
    let isNewBind = false;
    const existing = await prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: row.unionid } },
    });
    if (existing) {
      userId = existing.userId;
    } else {
      const matches = await prisma.user.findMany({
        where: { phone: row.mobile, deletedAt: null },
        select: { id: true },
      });
      if (matches.length === 0) {
        return err(new ApiError(ERROR_CODES.DINGTALK_PHONE_NOT_REGISTERED, undefined, 401));
      }
      if (matches.length > 1) {
        return err(new ApiError(ERROR_CODES.DINGTALK_PHONE_AMBIGUOUS, undefined, 401));
      }
      userId = matches[0]!.id;
      isNewBind = true;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.userIdentity.create({
            data: {
              userId: userId!,
              provider: "DINGTALK",
              providerUserId: row.unionid!,
              mobileSnapshot: row.mobile,
              unionidSnapshot: row.unionid,
              boundBy: "SELF",
            },
          });
          await tx.user.update({ where: { id: userId! }, data: { dingtalkBoundAt: new Date() } });
        });
      } catch (e) {
        const race = await prisma.userIdentity.findUnique({
          where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: row.unionid } },
        });
        if (!race) throw e;
        userId = race.userId;
        isNewBind = false;
      }
    }

    // 2) Validate user still ACTIVE
    const user = await loadActiveUser(userId);
    if (!user) {
      await prisma.dingtalkLoginCode.updateMany({
        where: { state, status: "READY" },
        data: { status: "CONSUMED", consumedAt: new Date(), consumedById: userId },
      });
      return err(new ApiError(ERROR_CODES.DINGTALK_USER_DISABLED, undefined, 401));
    }

    // 3) Optimistic consume
    const consume = await prisma.dingtalkLoginCode.updateMany({
      where: { state, status: "READY" },
      data: { status: "CONSUMED", consumedAt: new Date(), consumedById: user.id },
    });
    if (consume.count === 0) {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_CONSUMED, undefined, 409));
    }

    // 4) Audit
    await prisma.$transaction(async (tx) => {
      await audit(tx, {
        actorId: user.id,
        action: "dingtalk_login",
        entity: "User",
        entityId: user.id,
      });
      if (isNewBind) {
        await audit(tx, {
          actorId: user.id,
          action: "dingtalk_bind",
          entity: "User",
          entityId: user.id,
        });
      }
    });

    // 5) Sign JWT (same source as CredentialsProvider)
    const token = await encode({
      token: {
        uid: user.id,
        employeeNo: user.employeeNo,
        roleCode: user.role.code as RoleCode,
        iat: Math.floor(Date.now() / 1000),
        remember: true,
      },
      secret: env.NEXTAUTH_SECRET,
      maxAge: SESSION_MAX_AGE,
    });

    // 6) Set cookie (mirror NextAuth behavior: dev plain, prod __Secure-)
    const isProd = process.env.NODE_ENV === "production";
    const cookieName = isProd ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
    const secure = isProd;
    const cookie = `${cookieName}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;

    const res = ok({ ok: true, redirectTo: "/dashboard" });
    res.headers.append("Set-Cookie", cookie);
    return res;
  });
}