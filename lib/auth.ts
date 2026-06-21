// NextAuth v4 配置（JWT + Credentials；不挂 PrismaAdapter，简化 P0 阶段）
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { encode as defaultJwtEncode, decode as defaultJwtDecode } from "next-auth/jwt";
import { ROLE_PERMISSIONS, type Action, type Resource } from "./permissions";
import type { RoleCode } from "@/types/enums";
import { envBool } from "./env-bool";

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
    /** 登录页"7 天内自动登录"勾选状态:false 明确 8h 过期,true/缺省 走 session.maxAge (7d) */
    remember?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    employeeNo: string;
    roleCode: RoleCode;
    remember?: boolean;
  }
}

// 角色 / ACTIVE 状态的轻量缓存，避免每个请求都打 DB。
// 失效策略：TTL 到期自动失效；ADMIN 改角色/禁用户时无法即时反映。
// 5s 在"及时撤销"和"DB 压力"之间取保守中间值；禁用/角色变更已通过 invalidateAuthCache 主动失效。
const CACHE_TTL_MS = 5_000;
type CachedUser = { id: string; employeeNo: string; roleCode: RoleCode };
const userCache = new Map<string, { value: CachedUser | null; expiresAt: number }>();

async function loadActiveUser(uid: string): Promise<CachedUser | null> {
  const now = Date.now();
  const hit = userCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.value;
  const u = await prisma.user.findFirst({
    // isSystem=false 排除定时任务 / 自动转换用的占位 user,避免被当作真人加载
    where: { id: uid, deletedAt: null, status: "ACTIVE", isSystem: false },
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

const isProd = process.env.NODE_ENV === "production";
const forceHttps = envBool("FORCE_HTTPS");
if (isProd && !forceHttps) {
  console.warn("[AUTH] 生产环境使用非 Secure Cookie，请尽快配置 HTTPS 并设置 FORCE_HTTPS=true");
}

export const authOptions: AuthOptions = {
  // 7 天作为 cookie 寿命上限;实际 JWT 寿命由 jwt 回调里的 token.exp 决定
  // (remember=true/缺省 → 7d, remember=false → 8h)
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  // 安全 cookie 仅在 HTTPS 下生效,HTTP 下浏览器不存 secure cookie,CSRF token 不匹配,登录后无法跳转
  // 走 nginx HTTP 反代时: 不要设 FORCE_HTTPS (默认 non-secure); 走 HTTPS 时: 设 FORCE_HTTPS=true
  useSecureCookies: isProd ? forceHttps : false,
  // 自定义 jwt.encode:让"不勾选"登录的 session JWT 寿命 = 8h,勾选 = session.maxAge (7d)
  // 原因:NextAuth v4 的内置 encode 内部用 setExpirationTime(now() + maxAge) 直接覆盖 exp,
  // 仅在 jwt 回调里写 token.exp 无效;必须在这里拦截 maxAge
  jwt: {
    async encode(params) {
      const { token, maxAge, ...rest } = params;
      // token.remember 由 callbacks.jwt 在签发时设置 (true / false / undefined)
      const effectiveMaxAge = token?.remember === false
        ? 8 * 60 * 60
        : maxAge;
      return await defaultJwtEncode({ ...rest, token, maxAge: effectiveMaxAge });
    },
    async decode(params) {
      return await defaultJwtDecode(params);
    }
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        employeeNo: { label: "工号", type: "text" },
        password: { label: "密码", type: "password" },
        // 任意非内置字段都会通过 creds 传给 authorize;
        // "true"/"false" 字符串由 signIn(..., { remember }) 传过来,在 authorize 归一化为 boolean
        remember: { label: "记住我", type: "text" }
      },
      async authorize(creds) {
        if (!creds?.employeeNo || !creds?.password) return null;
        const user = await prisma.user.findFirst({
          // isSystem=false 排除定时任务占位 user; 它的 passwordHash 也是不合法 bcrypt
          where: { employeeNo: creds.employeeNo, deletedAt: null, status: "ACTIVE", isSystem: false },
          include: { role: true }
        });
        if (!user) return null;
        const ok = await bcrypt.compare(creds.password, user.passwordHash);
        if (!ok) return null;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        // 归一化:signIn(..., { remember }) 在 NextAuth 内部一律是字符串;
        // undefined 表示前端没传(老登录链路),按"未勾选"处理
        const remember = creds.remember === "true";
        return {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.name,
          email: user.email,
          roleCode: user.role.code as RoleCode,
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
        token.iat = Math.floor(Date.now() / 1000);
        token.remember = !!user.remember;
        // 真正的"压短"在下方 authOptions.jwt.encode 里:它读 token.remember
        // 决定 effective maxAge (false → 8h, true/缺省 → session.maxAge = 7d)。
        // 这里不再覆盖 token.exp,因为 NextAuth 内置 encode 会用 setExpirationTime(maxAge) 把它覆盖掉。
      }
      // 缓存查 user,确认仍 ACTIVE;5s 内复用,避免每个请求都打 DB
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
