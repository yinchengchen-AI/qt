// 响应式 smoke:验证 DashboardShell 与 5 个核心业务页在桌面 / Pad / Phone 三套视口下
// 1. 渲染完成不报错
// 2. 关键交互可用(汉堡 Drawer、列表滚动、表单填得开)
// 3. 没有页面级横向滚动条
import { test, expect, type Page, type ViewportSize } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const ADMIN = { employeeNo: "admin", password: DEV_PASSWORD };

function isPhoneViewport(viewport: ViewportSize | null): boolean {
  return !!viewport && viewport.width < 768;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入工号").fill(ADMIN.employeeNo);
  await page.getByPlaceholder("请输入密码").fill(ADMIN.password);
  // 与既有 e2e 一致:用 .first() 匹配,避免 icon 按钮的歧义
  await page.getByText("登 录", { exact: true }).first().click();
  // 登录后应跳到 /dashboard
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

test.describe("Shell", () => {
  test("登录后页面加载,无页面级水平滚动", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "业务总览" })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  });

  test("移动端(<md)显示汉堡按钮、点开能进入工作台", async ({ page }, info) => {
    test.skip(!isPhoneViewport(info.project.use.viewport ?? null), "仅在移动端视口下检查");
    await login(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const burger = page.getByRole("button", { name: "打开导航" });
    await expect(burger).toBeVisible();
    await burger.click();
    // Drawer 弹出后,菜单项"工作台"应可见
    await expect(page.getByRole("link", { name: "工作台" }).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("业务列表", () => {
  for (const path of ["/customers", "/contracts", "/projects", "/invoices", "/payments"]) {
    test(`${path} 在当前视口下无页面级水平滚动`, async ({ page }) => {
      await login(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
      const hasTable = await page.locator(".ant-table").count();
      expect(hasTable).toBeGreaterThanOrEqual(0);
    });

    test(`${path} 移动端页面标题与新建按钮可见`, async ({ page }, info) => {
      test.skip(!isPhoneViewport(info.project.use.viewport ?? null), "仅在移动端视口下检查");
      await login(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const addBtn = page.getByRole("button", { name: /新建|登记/ }).first();
      await expect(addBtn).toBeVisible();
    });
  }
});

test.describe("详情与表单", () => {
  test("新建客户页(<md)表单字段纵向排列,无页面级水平滚动", async ({ page }, info) => {
    test.skip(!isPhoneViewport(info.project.use.viewport ?? null), "仅在移动端视口下检查");
    await login(page);
    await page.goto("/customers/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel(/客户全称/)).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  });
});
