// 全局搜索冒烟: 顶栏输入关键字 → 下拉出现分组与条目 → 点击跳详情页
// 登录模式与 05-invoice-payment-flow.spec.ts 一致; 造数走 API, 搜索交互走 UI。
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const customerName = `E2E搜索客户-${stamp}`;

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string, password: string) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("工号", { exact: true }).fill(employeeNo);
    await page.getByPlaceholder("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登 录", exact: true }).click();
    // dev 模式按需编译 + 多项目连续跑时登录 POST 偶发 >10s, 放宽到 20s (生产构建无此问题)
    await page.waitForURL(/dashboard/, { timeout: 20000 });
  }
}

test("顶栏全局搜索命中客户并跳转详情", async ({ page }) => {
  await ensureLoggedIn(page, "admin", DEV_PASSWORD);
  // 用 API 快速造一个客户
  const res = await page.request.post("/api/customers", {
    data: {
      name: customerName,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13812345678"
    }
  });
  expect(res.ok()).toBeTruthy();

  const box = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  // 手机视口下顶栏只渲染搜索图标, 先点开全宽输入条
  if (!(await box.isVisible())) {
    await page.getByRole("button", { name: "搜索", exact: true }).click();
  }
  await box.click();
  await box.fill(`搜索客户-${stamp}`);
  // 防抖 300ms + 请求, 断言下拉出现"客户"分组与命中条目
  await expect(page.getByText(/^客户 \([1-9]/).first()).toBeVisible({ timeout: 8000 });
  await page.getByText(customerName, { exact: false }).first().click();
  await page.waitForURL(/\/customers\//, { timeout: 10000 });
  await expect(page.getByText(customerName).first()).toBeVisible();
  // 回归: 选中跳转后顶栏搜索框应已清空 (不再残留 hit:<cat>:<id> 内部编码)
  const boxAfter = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  if (!(await boxAfter.isVisible())) {
    await page.getByRole("button", { name: "搜索", exact: true }).click();
  }
  await expect(boxAfter).toHaveValue("");
});

test("Ctrl+K 聚焦搜索框 + 跳转后记录搜索历史", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 768, "桌面端用例 (快捷键仅桌面)");
  await ensureLoggedIn(page, "admin", DEV_PASSWORD);

  // 1) Ctrl+K 快捷键聚焦顶栏搜索框
  await page.keyboard.press("Control+k");
  const box = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  await expect(box).toBeFocused();

  // 2) 搜索并 Enter 跳"查看全部" → 历史被记录 (历史仅在真实跳转时写入)
  await box.fill(`搜索客户-${stamp}`);
  await expect(page.getByText(/^客户 \([1-9]/).first()).toBeVisible({ timeout: 8000 });
  await box.press("Enter");
  await page.waitForURL(/\/customers\?keyword=/, { timeout: 10000 });
  const hist = await page.evaluate(() => localStorage.getItem("qt-global-search-history"));
  expect(hist).toContain(`搜索客户-${stamp}`);

  // 3) 回工作台, 空输入聚焦 → 出现"最近搜索"分组
  // (不用 networkidle: 消息中心 SSE 长连接让 networkidle 永远达不到)
  await page.goto("/dashboard");
  await page.waitForLoadState("domcontentloaded");
  const box2 = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  await box2.click();
  await expect(page.getByText("最近搜索").first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(`搜索客户-${stamp}`).first()).toBeVisible();
});

test("Enter 跳查看全部列表页", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 768, "桌面端用例");
  await ensureLoggedIn(page, "admin", DEV_PASSWORD);

  const box = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  await box.click();
  await box.fill(`搜索客户-${stamp}`);
  await expect(page.getByText(/^客户 \([1-9]/).first()).toBeVisible({ timeout: 8000 });
  // 未用 ↑↓ 导航直接 Enter → 跳列表页带 keyword
  await box.press("Enter");
  await page.waitForURL(/\/customers\?keyword=/, { timeout: 10000 });
  await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10000 });
});
