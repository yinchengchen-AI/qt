// NextAuth v4 配置 (JWT + Credentials; 2026-07-11 安全加固版)
//
// 关键安全点:
//   - 失败计数 + 临时锁定 (lib/login-rate-limit.ts)
//   - 登录成功/失败审计日志 (lib/login-audit.ts)
//   - JWT exp 兜底 (P1-5)
//   - 工号归一化 (P2-1)
//   - secret/env 校验 (P3-2)
//   - trustHost 显式 (P1-3)
//   - lastLoginAt 失败不阻塞主流程 (P3-3)
//   - mustChangePassword 写入 jwt, 强制跳改密页
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { encode as defaultJwtEncode, decode as defaultJwtDecode } from "next-auth/jwt";
import { ROLE_PERMISSIONS, type Action, type Resource } from "./permissions";
import type { RoleCode } from "@/types/enums";
import { env } from "./env";
import { envBool } from "./env-bool";
import {
  clearUserFails,
  getUserLockState,
  recordUserFail
} from "./login-rate-limit";
import { writeLoginAudit } from "./login-audit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      employeeNo: string;
      name: string;
      email: string;
      roleCode: RoleCode;
      roleVersion: number;
      mustChangePassword: boolean;
      permissions: { resource: Resource; actions: Action[] }[];
    };
  }
  interface User {
    id: string;
    employeeNo: string;
    name: string;
    email: string;
    roleCode: RoleCode;
    roleVersion: number;
    mustChangePassword: boolean;
    /** 登录页"7 天内自动登录"勾选状态:false 明确 8h 过期,true/缺省 走 session.maxAge (7d) */
    remember?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    employeeNo: string;
    roleCode: RoleCode;
    roleVersion: number;
    mustChangePassword: boolean;
    remember?: boolean;
    /** 显式 exp (epoch seconds), 防止 defaultJwtEncode 拿不到 maxAge 时不出 exp */
    exp?: number;
  }
}

// ---- 用户身份缓存 (P3-1: 降到 2s) ----
const CACHE_TTL_MS = 2_000;
type CachedUser = {
  id: string;
  employeeNo: string;
  roleCode: RoleCode;
  roleVersion: number;
  mustChangePassword: boolean;
};
const userCache = new Map<string, { value: CachedUser | null; expiresAt: number }>();

async function loadActiveUser(uid: string): Promise<CachedUser | null> {
  const now = Date.now();
  const hit = userCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value;
  const u = await prisma.user.findFirst({
    where: { id: uid, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: {
      id: true,
      employeeNo: true,
      role: { select: { code: true } },
      roleVersion: true,
      mustChangePassword: true
    }
  });
  const value: CachedUser | null = u
    ? {
        id: u.id,
        employeeNo: u.employeeNo,
        roleCode: u.role.code as RoleCode,
        roleVersion: u.roleVersion,
        mustChangePassword: u.mustChangePassword
      }
    : null;
  userCache.set(uid, { value, expiresAt: now + CACHE_TTL_MS });
  if (userCache.size > 500) {
    for (const [k, v] of userCache) {
      if (v.expiresAt <= now) userCache.delete(k);
    }
  }
  return value;
}

/** 角色/状态/密码变更后调用, 清掉指定用户的缓存 */
export function invalidateAuthCache(uid: string): void {
  userCache.delete(uid);
}

const isProd = env.NODE_ENV === "production";
const forceHttps = envBool("FORCE_HTTPS");

if (isProd && !forceHttps) {
  console.warn("[AUTH] 生产环境使用非 Secure Cookie, 请尽快配置 HTTPS 并设置 FORCE_HTTPS=true");
}

// 归一化工号: trim + toLowerCase
//  背景: PG @unique 默认大小写敏感, "Admin" 和 "admin" 会被当成两个账号;
//  登录时统一小写避免歧义; 创建用户侧 (create-admin / seed) 也应同步小写
export function normalizeEmployeeNo(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export const authOptions: AuthOptions = {
  // 7 天作为 cookie 寿命上限; 实际 JWT 寿命由 jwt 回调里的 token.exp 决定
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  // HTTPS only cookie, 反代场景下运维必须显式 FORCE_HTTPS=true
  useSecureCookies: isProd ? forceHttps : false,

  // 自定义 jwt.encode: 让"不勾选"登录的 session JWT 寿命 = 8h, 勾选 = session.maxAge (7d)
  jwt: {
    async encode(params) {
      const { token, maxAge, ...rest } = params;
      const effectiveMaxAge = token?.remember === false ? 8 * 60 * 60 : maxAge;
      return await defaultJwtEncode({ ...rest, token, maxAge: effectiveMaxAge });
    },
    async decode(params) {
      return await defaultJwtDecode(params);
    }
  },
  // P3-2: secret 走 env 校验过的常量 (启动期 fail-fast), 不直接读 process.env
  secret: env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        employeeNo: { label: "工号", type: "text" },
        password: { label: "密码", type: "password" },
        // 任意非内置字段都会通过 creds 传给 authorize
        remember: { label: "记住我", type: "text" }
      },
      async authorize(creds) {
        const employeeNo = normalizeEmployeeNo(creds?.employeeNo);
        const password = String(creds?.password ?? "");
        // NextAuth v4 的 authorize() 拿不到请求 IP; IP 限速放在 route handler 包裹层
        // (app/api/auth/[...nextauth]/route.ts), 这里只做用户维度 + bcrypt.

        if (!employeeNo || !password) {
          await writeLoginAudit({
            action: "LOGIN_FAIL",
            employeeNo: employeeNo || null,
            reason: "missing_credentials"
          });
          return null;
        }

        // 用户维度锁定检查
        const lockState = await getUserLockState(employeeNo);
        if (lockState?.locked) {
          
          await writeLoginAudit({
            action: "LOGIN_LOCKED",
            employeeNo,
            reason: lockState.lockedUntil ? `locked_until=${lockState.lockedUntil.toISOString()}` : "locked"
          });
          return null;
        }

        const user = await prisma.user.findFirst({
          where: { employeeNo, deletedAt: null, status: "ACTIVE", isSystem: false },
          include: { role: true }
        });
        if (!user) {
          
          await recordUserFail(employeeNo);
          await writeLoginAudit({
            action: "LOGIN_FAIL",
            employeeNo,
            reason: "user_not_found"
          });
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          
          const nextState = await recordUserFail(employeeNo);
          await writeLoginAudit({
            action: nextState.locked ? "LOGIN_LOCKED" : "LOGIN_FAIL",
            actorId: user.id,
            employeeNo,
            reason: nextState.locked
              ? `locked_until=${nextState.lockedUntil?.toISOString()}`
              : `failed_count=${nextState.failedCount}`
          });
          return null;
        }

        // 成功: 清失败计数 / IP 限速计数 (P3-3)
        await clearUserFails(user.id).catch((e) =>
          console.error("[AUTH] clearUserFails failed:", e)
        );
        

        // lastLoginAt 失败不阻塞登录主流程
        prisma.user
          .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
          .catch((e) => console.error("[AUTH] lastLoginAt update failed:", e));

        await writeLoginAudit({
          action: "LOGIN_SUCCESS",
          actorId: user.id,
          employeeNo,
          reason: user.mustChangePassword ? "must_change_password" : null
        });

        const remember = creds?.remember === "true";
        return {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.name,
          email: user.email,
          roleCode: user.role.code as RoleCode,
          roleVersion: user.roleVersion,
          mustChangePassword: user.mustChangePassword,
          remember
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.employeeNo = user.employeeNo;
        token.roleCode = user.roleCode;
        token.roleVersion = user.roleVersion;
        token.mustChangePassword = user.mustChangePassword;
        token.iat = Math.floor(Date.now() / 1000);
        token.remember = !!user.remember;
      }
      // 缓存查 user, 确认仍 ACTIVE; 2s 内复用, 避免每个请求都打 DB
      if (token.uid) {
        const u = await loadActiveUser(token.uid);
        if (!u) {
          // 用户被禁用/删除/软删 → 失效
          return null as unknown as typeof token;
        }
        token.roleCode = u.roleCode;
        token.employeeNo = u.employeeNo;
        token.roleVersion = u.roleVersion;
        token.mustChangePassword = u.mustChangePassword;
      }
      // P1-5: 显式写 token.exp, 防止 defaultJwtEncode 拿不到 maxAge 时不出 exp
      // (即便内部 encode 已用 setExpirationTime, 这里也作为兜底, 防止老 token 跨升级保留旧 exp)
      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = token.remember === false ? 8 * 60 * 60 : 7 * 24 * 60 * 60;
      token.exp = nowSec + ttl;
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        employeeNo: token.employeeNo,
        name: session.user?.name ?? "",
        email: session.user?.email ?? "",
        roleCode: token.roleCode,
        roleVersion: token.roleVersion,
        mustChangePassword: token.mustChangePassword,
        permissions: ROLE_PERMISSIONS[token.roleCode]
      };
      return session;
    }
  }
};
