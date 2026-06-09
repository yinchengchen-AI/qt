// 场景 3：FINANCE 财务开票 + 对账 + 统计
import { test, expect } from "@playwright/test";

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string, password: string) {
  // 如果已在 dashboard 就不用再登录
  if (page.url().includes("/dashboard")) return;
  // 如果不是登录页就跳过去
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByPlaceholder("请输入工号").fill(employeeNo);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
}

test.describe.serial("场景 3: FINANCE 财务全链路", () => {
  test("03.1 FINANCE 登录", async ({ page }) => {
    await ensureLoggedIn(page, "finance", "123456");
    await expect(page).toHaveURL(/dashboard/);
  });

  test("03.2 FINANCE 访问开票管理", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.3 FINANCE 访问回款管理", async ({ page }) => {
    await page.goto("/payments");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.4 FINANCE 访问统计总览", async ({ page }) => {
    await page.goto("/statistics/overview");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.5 FINANCE 访问账龄分析", async ({ page }) => {
    await page.goto("/statistics/aging");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("03.6 FINANCE 访问业务员业绩", async ({ page }) => {
    await page.goto("/statistics/performance");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });
});
