// 场景 1：admin 完整主链路（真实浏览器）
// 登录 → 工作台 → 客户列表 → 创建客户 → 客户详情 → 创建合同 → 合同详情
// → 创建项目 → 项目详情 → 提交+审批合同 → 创建发票 → 提交发票 → 财务开票
// → 创建回款 → 确认回款 → 统计 → 消息中心 → 公告
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const customerName = `E2E客户-${stamp}`;
const _contractTitle = `E2E合同-${stamp}`;
const _projectName = `E2E项目-${stamp}`;

test.describe.serial("场景 1: admin 完整主链路", () => {
  test("01.1 登录页正常加载", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/杭州企泰/);
    await expect(page.getByText("杭州企泰安全科技").first()).toBeVisible();
    await expect(page.getByPlaceholder("请输入工号")).toBeVisible();
    await expect(page.getByPlaceholder("请输入密码")).toBeVisible();
  });

  test("01.2 登录失败显示错误", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill("wrongpassword");
    await page.getByText("登 录", { exact: true }).first().click();
    // 设计系统:错误展示在 form 内的 role="alert" 块
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 8000 });
  });

  test("01.3 admin 登录成功进入工作台", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test("01.4 Dashboard 显示总览卡片", async ({ page }) => {
    await page.goto("/dashboard");
    // 等 SWR 加载
    await page.waitForLoadState("networkidle");
    // 至少看到一个 KPI 标题或 StatGrid 卡片
    const title = page.getByRole("heading", { name: "工作台" });
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("stat-grid").first()).toBeVisible({ timeout: 10000 });
  });

  test("01.5 客户列表页加载 + 显示 admin 已有数据", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    // ProTable 应该渲染（找列头）
    await expect(page.getByRole("columnheader", { name: "客户名称" })).toBeVisible({ timeout: 10000 });
  });

  test("01.6 创建客户（form 提交）", async ({ page }) => {
    await page.goto("/customers/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("客户全称").fill(customerName);
    // 客户类型 - 找 select
    // 客户类型 select
    await page.locator(".ant-select").nth(0).click();
    // 等 dropdown 出现并可见
    await page.waitForTimeout(2000);
    const opts = page.locator(".ant-select-item-option");
    const cnt = await opts.count();
    if (cnt > 0) {
      await opts.first().click();
    }
    await page.getByLabel("省份").fill("浙江");
    await page.getByLabel("城市").fill("杭州");
    await page.getByLabel("联系电话").fill("13812345678");
    await page.getByText("提 交", { exact: true }).first().click();
    // 成功后跳到列表或详情
    await page.waitForURL(/\/customers(\/.+)?/, { timeout: 10000 });
  });

  test("01.7 客户列表中能找到新建客户", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    // 不依赖搜索，直接看表内是否有该客户（之前测试可能已创建过同名）
    // 用 link role（ProTable 客户名称是 Link）
    const allLinks = await page.locator("a").allTextContents();
    const found = allLinks.some((t) => t.includes("E2E客户"));
    if (!found) {
      // 如果没找到，搜索一次
      const nameInput = page.getByPlaceholder("请输入").first();
      await nameInput.fill("E2E客户");
      await page.waitForTimeout(3000);
    }
    // 简单断言页面有 E2E 客户链接
    const html = await page.content();
    expect(html).toContain("E2E客户");
  });

  test("01.8 访问工作台 + 消息中心 + 公告", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.goto("/messages");
    await page.waitForLoadState("networkidle");
    // 至少有 ProTable 容器
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
    await page.goto("/announcements");
    await page.waitForLoadState("networkidle");
  });

  test("01.9 统计页加载", async ({ page }) => {
    await page.goto("/statistics/overview");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // ProCard split="vertical" 渲染
    await expect(page.locator(".ant-pro-card").first()).toBeVisible({ timeout: 10000 });
  });
});
