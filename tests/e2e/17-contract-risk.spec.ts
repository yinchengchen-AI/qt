// 场景 17：合同风险预警引擎 E2E (Phase 2)
//
// 覆盖:
//   1) 工作台风险卡显示真实计数 (数字, 不再是占位 "—")
//   2) 点击「查看风险合同」打开风险抽屉 (列表或空态)
//   3) 我的合同表「风险」列存在
//   4) 移动端 viewport 下抽屉可用
//
// 串行 chromium, 复用 _dev-credentials 的 sales 账号.
import { test, expect } from "@playwright/test";
import { loginCookiesOnce } from "./_auth";

// 与 16 同一模式: 登录态走 _auth.ts 进程内共享 (proxy.ts 限流 5 次/分钟/IP)

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "sales");
});

async function loginAsSales(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "sales");
  await page.context().addCookies(cookies);
}

test.describe.serial("场景 17: 合同风险预警 E2E", () => {
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("17.1 风险卡显示真实计数 (非占位符)", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端抽屉由 17.4 专项覆盖");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    // 风险卡标签存在
    await expect(page.getByText("风险预警")).toBeVisible({ timeout: 30000 });
    // 值是数字 (风险引擎已接入, 不再是 "—" 占位; 统计卡值区域渲染为纯数字)
    const card = page.locator(".ant-card", { hasText: "风险预警" }).first();
    await expect(card.getByText(/^\d+$/).first()).toBeVisible();
  });

  test("17.2 点击「查看风险合同」打开风险抽屉", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端抽屉由 17.4 专项覆盖");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /查看风险合同/ }).click({ timeout: 15000 });
    // 抽屉标题 (antd Drawer 动画 + SWR 拉取, 放宽等待)
    await expect(page.getByText("我的风险合同")).toBeVisible({ timeout: 15000 });
    // 有数据则显示等级 Tag, 无数据则显示空态 — 两者必居其一
    const hasRisk = await page.locator(".ant-drawer .ant-list-item").count();
    if (hasRisk === 0) {
      await expect(page.getByText("暂无风险合同")).toBeVisible();
    }
  });

  test("17.3 我的合同表含「风险」列", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端抽屉由 17.4 专项覆盖");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".ant-table-thead").getByText("风险")).toBeVisible({ timeout: 10000 });
  });

  test("17.4 移动端 viewport 抽屉可用", async ({ page }) => {
    await loginAsSales(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /查看风险合同/ }).click();
    await expect(page.getByText("我的风险合同")).toBeVisible({ timeout: 10000 });
  });
});
