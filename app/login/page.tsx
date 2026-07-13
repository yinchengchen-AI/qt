import { LoginClient } from "./login-client";

// 在 Server Component 中读取 DEV_QUICK_FILL_PASSWORD, 再作为 props 传给 Client Component。
// Client Component 无法访问非 NEXT_PUBLIC_ 前缀的环境变量, 因此不能直接在浏览器端读取。
const QUICK_FILL_PASSWORD =
  process.env.NODE_ENV !== "production"
    ? process.env.DEV_QUICK_FILL_PASSWORD ?? "dev-only-fill"
    : "";

export default function LoginPage() {
  return <LoginClient quickFillPassword={QUICK_FILL_PASSWORD} />;
}
