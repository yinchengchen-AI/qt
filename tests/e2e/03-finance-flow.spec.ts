// 场景 3：FINANCE 财务开票 + 对账 + 统计
import { test, expect, type Page } from "@playwright/test";
import { loginCookiesOnce } from "./_auth";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "finance");
});

async function ensureLoggedIn(page: Page, employeeNo: string) {
  const cookies = await loginCookiesOnce(page.context().browser()!, employeeNo);
  await page.context().addCookies(cookies);
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
  if (!page.url().includes("/dashboard")) await page.goto("/dashboard");
}

test.describe.serial("场景 3: FINANCE 财务全链路", () => {
  test("03.1 FINANCE 登录", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await expect(page).toHaveURL(/dashboard/);
  });

  test("03.2 FINANCE 访问开票管理", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/invoices");
  
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.3 FINANCE 访问回款管理", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/payments");
  
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.4 FINANCE 访问统计总览", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/overview");
  
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.5 FINANCE 访问账龄分析", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/aging");
  
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.6 FINANCE 访问员工业绩", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/performance");
  
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });
});
