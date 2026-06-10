// 场景 5：会话生命周期 + 登出 + 多用户切换
import { test } from "@playwright/test";

test.describe.serial("场景 5: 会话生命周期", () => {
  test("05.1 登出后再访问 dashboard 应跳回登录", async ({ page }) => {
    // 登录
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill("123456");
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });

    // 找登出按钮（右上角下拉）
    // ProLayout 通常在 user dropdown
    // 直接调 next-auth signout endpoint
    await page.goto("/api/auth/signout");
    // NextAuth signout 页有 "Sign out" 按钮
    const signoutBtn = page.getByRole("button", { name: /Sign out|登出|注销/ });
    if (await signoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signoutBtn.click();
    }
    await page.waitForTimeout(1000);

    // 再访问 dashboard 应该被 redirect 到 /login
    await page.goto("/dashboard");
    await page.waitForURL(/login/, { timeout: 10000 });
  });

  test("05.2 同一浏览器切换 admin → sales", async ({ page, context }) => {
    // 清 cookies
    await context.clearCookies();
    // admin 登录
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill("123456");
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
    // 退出
    await page.goto("/api/auth/signout");
    const signoutBtn = page.getByRole("button", { name: /Sign out|登出|注销/ });
    if (await signoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signoutBtn.click();
    }
    await page.waitForTimeout(500);
    // sales 登录
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("sales");
    await page.getByPlaceholder("请输入密码").fill("123456");
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
  });
});
