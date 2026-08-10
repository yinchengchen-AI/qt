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
    await page.waitForURL(/dashboard/, { timeout: 10000 });
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
