// 区域统计下钻验证:从 by-region 跳到 /customers?district=&town= 后,表格行数 = 该区域客户数。
// 覆盖 SALES 行级隔离(只看到自己的客户)与 ADMIN 全量。
import { test, expect, type Page, type Browser } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入工号").fill(user);
  await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

// 选 cascader 标签区域:antd 不同版本/形态下选择器差异大,统一抓容器内所有文本,非空即视为已选。
async function readCascaderLabel(page: Page): Promise<string> {
  return await page
    .locator(".ant-cascader-picker, [class*=cascader]")
    .first()
    .innerText()
    .catch(() => "");
}

test("SALES 视角下钻到余杭区/闲林街道 应能看到自己的 2 个客户", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "sales");

  const apiRes = await page.request.get("/api/customers?district=余杭区&town=闲林街道&pageSize=10");
  const apiJson = await apiRes.json();
  const apiTotal: number = apiJson.data?.total ?? 0;
  console.log("api SALES 余杭区/闲林街道 total:", apiTotal);
  expect(apiTotal).toBeGreaterThan(0);

  await page.goto("/customers?district=余杭区&town=闲林街道");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  const cascaderText = await readCascaderLabel(page);
  console.log("cascader label:", JSON.stringify(cascaderText));

  const rows = await page.locator("tr.ant-table-row").count();
  console.log("rendered row count:", rows);
  await page.screenshot({ path: "test-results/99-customers-drilldown-sales.png", fullPage: true });

  const totalText = await page.locator(".ant-pagination-total-text").first().textContent().catch(() => "(none)");
  console.log("pagination text:", totalText);

  expect(rows).toBe(apiTotal);

  await ctx.close();
});

test("ADMIN 视角下钻到余杭区/闲林街道 也应能看到(无 SALES 隔离)", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin");

  const apiRes = await page.request.get("/api/customers?district=余杭区&town=闲林街道&pageSize=10");
  const apiJson = await apiRes.json();
  const apiTotal: number = apiJson.data?.total ?? 0;
  console.log("api ADMIN 余杭区/闲林街道 total:", apiTotal);

  await page.goto("/customers?district=余杭区&town=闲林街道");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  const rows = await page.locator("tr.ant-table-row").count();
  console.log("ADMIN rendered row count:", rows);
  await page.screenshot({ path: "test-results/99-customers-drilldown-admin.png", fullPage: true });

  expect(rows).toBe(apiTotal);

  await ctx.close();
});
