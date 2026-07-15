import { LoginClient } from "./login-client";
import { getDevQuickFillPassword } from "@/lib/dev-quick-fill";

// Server Component 读 env, 通过 lib/dev-quick-fill.ts 统一封装 (含 NODE_ENV 守卫与默认值),
// 然后作为 props 传给 Client Component — 这样客户端 bundle 不会包含密码字面量,
// 也不会出现 `process.env.DEV_QUICK_FILL_PASSWORD` 这种敏感引用。
const QUICK_FILL_PASSWORD = getDevQuickFillPassword();

export default function LoginPage() {
  return <LoginClient quickFillPassword={QUICK_FILL_PASSWORD} />;
}