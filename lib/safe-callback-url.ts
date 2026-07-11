// callbackUrl 安全校验 (2026-07-11 hardening)
// P1-4: 用 URL 解析做白名单, 而不是黑名单字符串.
// 必须满足:
//   - 以 "/" 开头 (站内路径)
//   - 不以 "//" 或 "/\" 开头 (防 protocol-relative / 反斜杠绕过)
//   - 解析成绝对 URL 后 origin 与传入 origin 一致
//   - 不含 userinfo (防 "//user@evil.com" 这类)
// SSR/SSG 时 origin 为空, 此时只做基础白名单, 客户端水合后会再跑一次校验.
const FORBIDDEN_SCHEME = /^[a-z][a-z0-9+\-.]*:/i;

export function safeCallbackUrl(
  raw: string | null | undefined,
  origin: string
): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  if (FORBIDDEN_SCHEME.test(raw)) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;

  if (!origin) {
    // SSR: 只放行纯路径, 留客户端水合后校验
    return raw;
  }

  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return fallback;
    if (u.username || u.password) return fallback;
    // 仅放行 path + search + hash (避免 host 字段污染)
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
