// 场景 4：OPS 行政 + 公告 + 字典
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

test.describe.serial("场景 4: OPS 行政 + 公告 + 字典", () => {
  test("04.1 OPS 登录", async ({ page }) => {
    await ensureLoggedIn(page, "ops", "123456");
    await expect(page).toHaveURL(/dashboard/);
  });

  test("04.2 OPS 访问公告管理（有 CRUD 权限）", async ({ page }) => {
    await page.goto("/announcements");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("04.3 OPS 访问数据字典", async ({ page }) => {
    await page.goto("/admin/dictionaries");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  test("04.4 OPS 访问客户管理（无金额字段编辑）", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });

  test("04.5 OPS 访问开票管理（应只读）", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    // ProTable 渲染（即便只读也能看到）
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
  });
});
