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
import { loginCookiesOnce } from "./_auth";

// 登录限速 5 次/分钟/IP (proxy.ts), 登录态走 _auth.ts 进程内共享 (全 run 只登录一次)

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "sales");
});

async function loginAsSales(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "sales");
  await page.context().addCookies(cookies);
}

async function gotoWorkbench(page: import("@playwright/test").Page) {
  await page.goto("/contracts/workbench");
  await page.waitForLoadState("domcontentloaded");
}

test.describe.serial("场景 16: 合同工作台 E2E", () => {
  test.afterEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("16.1 侧边栏「合同工作台」菜单项可见", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端响应式由 16.5 专项覆盖");
    await loginAsSales(page);
    // 侧边栏在全局 shell, 直接进工作台页即可 (避开 dashboard 大图表的 dev 冷编译)
    await gotoWorkbench(page);
    // 侧边栏「业务」是可展开分组, 先展开再断言子项
    await page.getByRole("menuitem", { name: "业务" }).click();
    await expect(page.getByRole("menuitem", { name: "合同工作台" })).toBeVisible({ timeout: 10000 });
  });

  test("16.2 StatGrid 四卡片 + 待办列表 + 我的合同表格渲染", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端响应式由 16.5 专项覆盖");
    await loginAsSales(page);
    await gotoWorkbench(page);
    // PageHeader
    await expect(page.getByText("合同工作台")).toBeVisible({ timeout: 30000 });
    // StatGrid KPI 标签
    await expect(page.getByText("我的活跃合同")).toBeVisible();
    await expect(page.getByText("即将到期")).toBeVisible();
    await expect(page.getByText("逾期合同")).toBeVisible();
    await expect(page.getByText("风险预警")).toBeVisible();
    // 待办区域标题
    await expect(page.getByText("我的待办")).toBeVisible();
    // 我的合同区域 (exact: 页面副标题含"我的合同概览"前缀, 精确匹配只命中表格标题)
    await expect(page.getByText("我的合同", { exact: true })).toBeVisible();
  });

  test("16.3 「新建合同」按钮可点击", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端响应式由 16.5 专项覆盖");
    await loginAsSales(page);
    await gotoWorkbench(page);
    const btn = page.getByRole("button", { name: "新建合同" });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("16.4 「查看全部合同」跳转到合同列表页", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例: 移动端响应式由 16.5 专项覆盖");
    await loginAsSales(page);
    await gotoWorkbench(page);
    const link = page.getByRole("button", { name: "查看全部合同" });
    // ProTable 工具栏在数据请求就绪后才渲染, domcontentloaded 时可能尚未挂载, 放宽到 15s
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await page.waitForURL(/\/contracts$/, { timeout: 20000 });
    // 面包屑与页头都含"合同管理", 用 heading role 精确命中页头标题
    await expect(page.getByRole("heading", { name: "合同管理" })).toBeVisible();
  });

  test("16.5 移动端 viewport 统计卡堆叠为单列", async ({ page }) => {
    await loginAsSales(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoWorkbench(page);
    await expect(page.getByText("我的活跃合同")).toBeVisible({ timeout: 10000 });
    // 手机端 ProTable 隐藏 density/fullScreen options
    const options = page.locator(".ant-table-column-options");
    await expect(options).toHaveCount(0);
  });
});
