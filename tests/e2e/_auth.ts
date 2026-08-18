// E2E 共享登录态 (进程内缓存)
//
// 约束: proxy.ts 对 /api/auth/callback/credentials 限流 5 次/分钟/IP。
// 每个 spec 文件 × 每个 project 各自 beforeAll 登录会爆限额 (3 projects × N 文件)。
// playwright.config workers=1 → 全部测试同进程串行, 模块级缓存可跨文件/跨 project 复用
// 同一个 JWT cookie (服务器签发, 与浏览器 context 无关)。
import type { Browser, Cookie } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const cache = new Map<string, Promise<Cookie[]>>();

/** 全进程共享一次登录; 同一 employeeNo 只打一次 credentials 端点 */
export function loginCookiesOnce(browser: Browser, employeeNo: string): Promise<Cookie[]> {
  let p = cache.get(employeeNo);
  if (!p) {
    p = (async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.getByPlaceholder("工号", { exact: true }).fill(employeeNo);
      await page.getByPlaceholder("密码", { exact: true }).fill(DEV_PASSWORD);
      const respPromise = page.waitForResponse(
        (r) => r.url().includes("/api/auth/callback/credentials"),
        { timeout: 30000 }
      );
      await page.getByRole("button", { name: "登 录", exact: true }).click();
      const resp = await respPromise;
      if (!resp.ok()) throw new Error(`login failed for ${employeeNo}: ${resp.status()}`);
      const cookies = await ctx.cookies();
      await ctx.close();
      return cookies;
    })();
    // 失败不缓存, 让下一次调用重试
    p.catch(() => cache.delete(employeeNo));
    cache.set(employeeNo, p);
  }
  return p;
}
