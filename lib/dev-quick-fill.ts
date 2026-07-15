/**
 * 开发/预览环境:返回登录页"测试账号"快速填充卡使用的统一密码。
 * 生产环境返回空串,Next.js 的 dead-code elimination 会把整段折掉,
 * DOM 上不会渲染测试卡,密码也不会出现在客户端 bundle。
 *
 * 纯函数 + 仅供 Server Component 调用 (`app/login/page.tsx`),绝不能在
 * 客户端组件 / Client Action 中直接 import 使用 — 那样反而会把字符串
 * 打进客户端 bundle 泄露密码字面量。
 */
export function getDevQuickFillPassword(): string {
  if (process.env.NODE_ENV === "production") return "";
  return process.env.DEV_QUICK_FILL_PASSWORD ?? "dev-only-fill";
}