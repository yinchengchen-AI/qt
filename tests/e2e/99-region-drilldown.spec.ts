// 区域下钻验证:业绩排行页「按区域」行点击跳到 /customers?district=&town= 后,表格行数 = 该区域客户数。
// 客户列表读已放开(v0.18 起 SALES/EXPERT 可浏览全公司客户),SALES/ADMIN 看到的行数一致,
// 两条用例验证的是下钻参数传递与行数 = API total,不再是行级隔离。
// 区域用 seed:dev-customers 的固定 tier (余杭区/瓶窑镇 — 与 china-divisions 树一致,cascader 可解析);
// 不用 networkidle(消息轮询等长连接不 settle),改等具体响应。
import { test, expect, type Page, type Browser } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const DISTRICT = "余杭区";
const TOWN = "瓶窑镇";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByPlaceholder("工号", { exact: true }).fill(user);
  await page.getByPlaceholder("密码", { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "登 录", exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  // 登录后可能弹「更新日志 / 公告」Modal 挡住后续点击,统一关掉
  const modal = page.locator(".ant-modal-wrap").first();
  if (await modal.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

async function drilldown(page: Page, user: string, screenshot: string) {
  await login(page, user);

  const apiRes = await page.request.get(
    `/api/customers?district=${encodeURIComponent(DISTRICT)}&town=${encodeURIComponent(TOWN)}&pageSize=10`
  );
  const apiJson = await apiRes.json();
  const apiTotal: number = apiJson.data?.total ?? 0;
  console.log(`api ${user} ${DISTRICT}/${TOWN} total:`, apiTotal, "code:", apiJson.code, apiJson.message ?? "");
  expect(apiTotal, `API 应返回该区域客户(code=${apiJson.code} ${apiJson.message ?? ""})`).toBeGreaterThan(0);

  // 等带 district 参数的客户列表响应回来再数行,避免拿到未过滤的旧列表
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/customers?") && r.url().includes("district=") && r.request().method() === "GET",
    { timeout: 15000 }
  );
  await page.goto(`/customers?district=${encodeURIComponent(DISTRICT)}&town=${encodeURIComponent(TOWN)}`);
  await respPromise;
  await page.locator("tr.ant-table-row").first().waitFor({ timeout: 10000 });

  const rows = await page.locator("tr.ant-table-row").count();
  console.log(`${user} rendered row count:`, rows);
  await page.screenshot({ path: screenshot, fullPage: true });

  // 列表页默认 pageSize=20,总数超一页时渲染行数 = 首页行数
  expect(rows).toBe(Math.min(apiTotal, 20));
}

test("SALES 视角下钻到余杭区/瓶窑镇 行数与 API 一致(读已放开)", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await drilldown(page, "sales", "test-results/99-customers-drilldown-sales.png");
  await ctx.close();
});

test("ADMIN 视角下钻到余杭区/瓶窑镇 应能看到(无 SALES 隔离)", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await drilldown(page, "admin", "test-results/99-customers-drilldown-admin.png");
  await ctx.close();
});
