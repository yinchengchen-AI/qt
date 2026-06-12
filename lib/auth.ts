// NextAuth v4 配置（JWT + Credentials；不挂 PrismaAdapter，简化 P0 阶段）
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { ROLE_PERMISSIONS, type Action, type Resource } from "./permissions";
import type { RoleCode } from "@/types/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      employeeNo: string;
      name: string;
      email: string;
      roleCode: RoleCode;
      permissions: { resource: Resource; actions: Action[] }[];
    };
  }
  interface User {
    id: string;
    employeeNo: string;
    name: string;
    email: string;
    roleCode: RoleCode;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    employeeNo: string;
    roleCode: RoleCode;
  }
}

// 角色 / ACTIVE 状态的轻量缓存，避免每个请求都打 DB。
// 失效策略：TTL 到期自动失效；ADMIN 改角色/禁用户时无法即时反映。
// 30s 在"及时撤销"和"DB 压力"之间取中间值；如需立即撤销可缩短到 5s。
const CACHE_TTL_MS = 30_000;
type CachedUser = { id: string; employeeNo: string; roleCode: RoleCode };
const userCache = new Map<string, { value: CachedUser | null; expiresAt: number }>();

async function loadActiveUser(uid: string): Promise<CachedUser | null> {
  const now = Date.now();
  const hit = userCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value;
  const u = await prisma.user.findFirst({
    where: { id: uid, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, role: { select: { code: true } } }
  });
  const value: CachedUser | null = u
    ? { id: u.id, employeeNo: u.employeeNo, roleCode: u.role.code as RoleCode }
    : null;
  userCache.set(uid, { value, expiresAt: now + CACHE_TTL_MS });
  // 防止 Map 无限增长：定期清理
  if (userCache.size > 500) {
    for (const [k, v] of userCache) {
      if (v.expiresAt <= now) userCache.delete(k);
    }
  }
  return value;
}

/** 角色 / 状态变更后调用，清掉指定用户的缓存 */
export function invalidateAuthCache(uid: string): void {
  userCache.delete(uid);
}

// env 字符串的布尔解析: "true"/"1"/"yes" (大小写不敏感) 视为 true, 其余 (含 "false"/"0"/空/undefined) 一律 false。
// !!process.env.X 是经典 bug — 任何非空字符串 (包括 "false") 都是 truthy,会导致 FORCE_HTTPS=false 被当成 true,
// 触发 useSecureCookies=true, 浏览器在 HTTP 下不存 secure cookie,登录 CSRF token 不匹配,登录后无法跳转。
function envBool(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

const isProd = process.env.NODE_ENV === "production";
const forceHttps = envBool("FORCE_HTTPS");
if (isProd && !forceHttps) {
  console.warn("[AUTH] 生产环境使用非 Secure Cookie，请尽快配置 HTTPS 并设置 FORCE_HTTPS=true");
}

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  // 安全 cookie 仅在 HTTPS 下生效,HTTP 下浏览器不存 secure cookie,CSRF token 不匹配,登录后无法跳转
  // 走 nginx HTTP 反代时: 不要设 FORCE_HTTPS (默认 non-secure); 走 HTTPS 时: 设 FORCE_HTTPS=true
  useSecureCookies: isProd ? forceHttps : false,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        employeeNo: { label: "工号", type: "text" },
        password: { label: "密码", type: "password" }
      },
      async authorize(creds) {
        if (!creds?.employeeNo || !creds?.password) return null;
        const user = await prisma.user.findFirst({
          where: { employeeNo: creds.employeeNo, deletedAt: null, status: "ACTIVE" },
          include: { role: true }
        });
        if (!user) return null;
        const ok = await bcrypt.compare(creds.password, user.passwordHash);
        if (!ok) return null;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.name,
          email: user.email,
          roleCode: user.role.code as RoleCode
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
        token.iat = Math.floor(Date.now() / 1000);
      }
      // 缓存查 user,确认仍 ACTIVE;30s 内复用,避免每个请求都打 DB
      if (token.uid) {
        const u = await loadActiveUser(token.uid);
        if (!u) {
          // 用户被禁用/删除/软删 → 失效:NextAuth 看到空 token 会让 session 返回 null
          // 不要返回 `{} as typeof token` 这种类型欺骗,直接清字段更显式
          return null as unknown as typeof token;
        }
        token.roleCode = u.roleCode;
        token.employeeNo = u.employeeNo;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        employeeNo: token.employeeNo,
        name: session.user?.name ?? "",
        email: session.user?.email ?? "",
        roleCode: token.roleCode,
        permissions: ROLE_PERMISSIONS[token.roleCode]
      };
      return session;
    }
  },
  secret: process.env.NEXTAUTH_SECRET
};