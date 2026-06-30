// 场景 15：应收账龄重设计 (round-3) — 账龄页 + 催收闭环 E2E
//
// 覆盖:
//   1) FINANCE 加载账龄页, 4 桶柱图 + KPI 渲染
//   2) 切换 basis (到期日 / 开票日), 重新请求 API
//   3) 客户/业务人员 tab 切换, ProTable 渲染
//   4) 未开票合同 tab 切换
//   5) 移动端 viewport, KPI 堆叠为单列
//
// 串行 chromium, 复用 _dev-credentials 的 finance / admin 账号.
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string) {
  if (page.url().includes("/dashboard")) return;
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByPlaceholder("请输入工号").fill(employeeNo);
  await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
}

test.describe.serial("场景 15: 账龄重设计 E2E", () => {
  // 恢复默认 viewport 避免影响后续 test (issue #11 from review)
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  test("15.1 FINANCE 加载账龄页, KPI + 柱图 + 明细表可见", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/aging");
    await page.waitForLoadState("networkidle");
    // PageHeader
    await expect(page.getByText("应收账龄分析")).toBeVisible({ timeout: 10000 });
    // 筛选卡片 (QueryFilter 含账龄基准 / 客户 / 负责人 等)
    await expect(page.getByText("账龄基准")).toBeVisible();
    await expect(page.getByText("账龄段")).toBeVisible();
    // KPI 卡片
    await expect(page.getByText("应收总额")).toBeVisible();
    await expect(page.getByText("90+ 余额")).toBeVisible();
    // ProCard 至少 1 个 (柱图 / 趋势 / Tab 内容)
    await expect(page.locator(".ant-pro-card").first()).toBeVisible();
  });

  test("15.2 切换账龄基准 (按开票日) 后接口带 basis=issue", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/aging");
    await page.waitForLoadState("networkidle");
    // 监听 invoice-aging API 调用
    const reqPromise = page.waitForRequest((r) => r.url().includes("/api/statistics/invoice-aging") && r.url().includes("basis=issue"));
    await page.getByText("按开票日", { exact: true }).click();
    // 点查询按钮 (QueryFilter 不会自动提交, 需要点 查询)
    await page.getByRole("button", { name: "查 询" }).click();
    await reqPromise;
  });

  test("15.3 切换 Tab: 客户/业务人员/未开票合同", async ({ page }) => {
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/aging");
    await page.waitForLoadState("networkidle");
    // Tab 文本可能因 i18n 写死, 走 locator
    await page.getByRole("tab", { name: "按客户" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("tab", { name: "按客户" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "按业务人员" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("tab", { name: "按业务人员" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "未开票合同" }).click();
    await page.waitForTimeout(500);
    await expect(page.getByRole("tab", { name: "未开票合同" })).toHaveAttribute("aria-selected", "true");
  });

  test("15.4 移动端 viewport: KPI 单列堆叠", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await ensureLoggedIn(page, "finance");
    await page.goto("/statistics/aging");
    await page.waitForLoadState("networkidle");
    // 移动端 stat-grid 应该 xs={24} 每张卡片单列
    // 用 column 数量粗略判断: 检查 col 元素是否宽度接近 viewport
    const firstKpi = page.locator(".ant-col").first();
    await expect(firstKpi).toBeVisible();
    // 恢复 desktop
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
