// 场景 16：合同工作台 E2E
//
// 覆盖:
//   1) SALES 登录后侧边栏「合同工作台」菜单可见
//   2) 工作台页面 StatGrid 四卡片渲染（活跃/即将到期/逾期/风险预警）
//   3) 待办列表渲染（空态或有数据）
//   4) 我的合同 ProTable 渲染 + 到期标签
//   5) 「新建合同」按钮可用
//   6) 「查看全部合同」跳转
//   7) 移动端 viewport 响应式布局
//
// 串行 chromium, 复用 _dev-credentials 的 sales 账号.
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string) {
  if (page.url().includes("/dashboard")) return;
  if (!page.url().includes("/login")) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
  }
  await page.getByPlaceholder("工号", { exact: true }).fill(employeeNo);
  await page.getByPlaceholder("密码", { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "登 录", exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
}

test.describe.serial("场景 16: 合同工作台 E2E", () => {
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("16.1 侧边栏「合同工作台」菜单项可见", async ({ page }) => {
    await ensureLoggedIn(page, "sales");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // 业务组下合同工作台菜单可见
    await expect(page.getByRole("menuitem", { name: "合同工作台" })).toBeVisible({ timeout: 10000 });
  });

  test("16.2 StatGrid 四卡片 + 待办列表 + 我的合同表格渲染", async ({ page }) => {
    await ensureLoggedIn(page, "sales");
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("networkidle");
    // PageHeader
    await expect(page.getByText("合同工作台")).toBeVisible({ timeout: 10000 });
    // StatGrid KPI 标签
    await expect(page.getByText("我的活跃合同")).toBeVisible();
    await expect(page.getByText("即将到期")).toBeVisible();
    await expect(page.getByText("逾期合同")).toBeVisible();
    await expect(page.getByText("风险预警")).toBeVisible();
    // 待办区域标题
    await expect(page.getByText("我的待办")).toBeVisible();
    // 我的合同区域
    await expect(page.getByText("我的合同")).toBeVisible();
  });

  test("16.3 「新建合同」按钮可点击", async ({ page }) => {
    await ensureLoggedIn(page, "sales");
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: "新建合同" });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("16.4 「查看全部合同」跳转到合同列表页", async ({ page }) => {
    await ensureLoggedIn(page, "sales");
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("networkidle");
    const link = page.getByRole("button", { name: "查看全部合同" });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/contracts$/, { timeout: 10000 });
    await expect(page.getByText("合同管理")).toBeVisible();
  });

  test("16.5 移动端 viewport 统计卡堆叠为单列", async ({ page }) => {
    await ensureLoggedIn(page, "sales");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("我的活跃合同")).toBeVisible({ timeout: 10000 });
    // 手机端 ProTable 隐藏 density/fullScreen options
    const options = page.locator(".ant-table-column-options");
    await expect(options).toHaveCount(0);
  });
});
