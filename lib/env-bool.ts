// env 字符串的布尔解析: "true"/"1"/"yes" (大小写不敏感) 视为 true, 其余 (含 "false"/"0"/空/undefined) 一律 false。
// !!process.env.X 是经典 bug — 任何非空字符串 (包括 "false") 都是 truthy,会导致
// FORCE_HTTPS=false 被当成 true,触发 useSecureCookies=true,浏览器在 HTTP 下不存 secure cookie,
// 登录 CSRF token 不匹配,登录后无法跳转。
export function envBool(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
