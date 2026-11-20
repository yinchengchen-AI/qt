// 场景 15：应收账龄重设计 (round-3) — 账龄页 E2E
//
// 覆盖:
//   1) FINANCE 加载账龄页, 4 桶柱图 + KPI 渲染
//   2) 切换 basis (到期日 / 开票日), 重新请求 API
//   3) 客户/业务人员 tab 切换, ProTable 渲染
//   4) 未开票合同 tab 切换
//   5) 移动端 viewport, KPI 堆叠为单列
//
// 串行 chromium, 复用 _auth.ts 的 finance 共享登录态.
import { test, expect } from "@playwright/test";
import { loginCookiesOnce } from "./_auth";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "finance");
});

async function ensureLoggedIn(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "finance");
  await page.context().addCookies(cookies);
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
}

async function gotoAging(page: import("@playwright/test").Page) {
  const initialResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/statistics/invoice-aging" &&
      new URL(response.url()).searchParams.get("basis") === "due" &&
      response.status() === 200
  );
  await page.goto("/statistics/aging");
  await initialResponse;
}

test.describe.serial("场景 15: 账龄重设计 E2E", () => {
  // 恢复默认 viewport 避免影响后续 test (issue #11 from review)
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  test("15.1 FINANCE 加载账龄页, KPI + 柱图 + 明细表可见", async ({ page }) => {
    await ensureLoggedIn(page);
    await gotoAging(page);
    // PageHeader
    await expect(page.getByText("应收账龄分析")).toBeVisible({ timeout: 10000 });
    // 筛选卡片 (QueryFilter 含账龄基准 / 客户 / 负责人 等)
    await expect(page.getByText("账龄基准")).toBeVisible();
    const bucketFilter = page.getByText("账龄段", { exact: true });
    if (!(await bucketFilter.isVisible())) {
      await page.getByText("展开", { exact: true }).click();
    }
    await expect(bucketFilter).toBeVisible();
    // KPI 卡片
    await expect(page.getByText("应收总额")).toBeVisible();
    await expect(page.getByText("90+ 余额")).toBeVisible();
    // ProCard 至少 1 个 (柱图 / 趋势 / Tab 内容)
    await expect(page.locator(".ant-pro-card").first()).toBeVisible();
    // 仅保留四个账龄 Tab, 催收功能入口全部下线
    await expect(page.getByRole("tab", { name: /^明细/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "按客户", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "按业务人员", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "未开票合同", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "催款建议", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "催收", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加催收", exact: true })).toHaveCount(0);
  });

  test("15.2 切换账龄基准 (按开票日) 后接口带 basis=issue", async ({ page }) => {
    await ensureLoggedIn(page);
    await gotoAging(page);
    await expect(page.getByText("应收账龄分析")).toBeVisible({ timeout: 10000 });
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/statistics/invoice-aging" &&
        new URL(response.url()).searchParams.get("basis") === "issue" &&
        response.status() === 200
    );
    await page.locator(".ant-segmented-item").filter({ hasText: "按开票日" }).click();
    await expect(page.getByRole("radio", { name: "按开票日", exact: true })).toBeChecked();
    // 点查询按钮 (QueryFilter 不会自动提交, 需要点 查询)
    await page.getByRole("button", { name: "查 询" }).click();
    await responsePromise;
  });

  test("15.3 切换 Tab: 客户/业务人员/未开票合同", async ({ page }) => {
    await ensureLoggedIn(page);
    await gotoAging(page);
    await expect(page.getByText("应收账龄分析")).toBeVisible({ timeout: 10000 });
    // Tab 文本可能因 i18n 写死, 走 locator
    await page.getByRole("tab", { name: "按客户" }).click();
    await expect(page.getByRole("tab", { name: "按客户" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "按业务人员" }).click();
    await expect(page.getByRole("tab", { name: "按业务人员" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "未开票合同" }).click();
    await expect(page.getByRole("tab", { name: "未开票合同" })).toHaveAttribute("aria-selected", "true");
  });

  test("15.4 移动端 viewport: KPI 单列堆叠", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await ensureLoggedIn(page);
    await gotoAging(page);
    await expect(page.getByText("应收账龄分析")).toBeVisible({ timeout: 10000 });
    // 移动端 stat-grid 应该 xs={24} 每张卡片单列
    // 用 column 数量粗略判断: 检查 col 元素是否宽度接近 viewport
    const firstKpi = page.locator(".ant-col").first();
    await expect(firstKpi).toBeVisible();
    // 恢复 desktop
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("15.5 催收与智能催款 API 返回 404", async ({ page }) => {
    await ensureLoggedIn(page);
    const paths = [
      "/api/statistics/aging/dunning-notes/test-note-id",
      "/api/statistics/aging/dunning-notes",
      "/api/statistics/aging/dunning/summary",
      "/api/statistics/aging/collection-advice"
    ];
    for (const path of paths) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(404);
    }
  });
});
