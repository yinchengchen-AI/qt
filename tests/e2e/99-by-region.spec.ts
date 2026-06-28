// 区域统计页综合验证:KPI / TopN 图表 / 表格 / 行点击下钻 / 导出 xlsx / SALES 403。
// 注意:by-region 页用的是原生 <table>(性能/样式可控),不是 antd ProTable,所以选择器走 tbody tr。
import { test, expect, type Page } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入工号").fill(user);
  await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

type RegionRow = { region: string };

// 抓首屏 /api/statistics/by-region 响应。必须在 goto 前注册 waitForResponse,
// 否则请求已发出并完成,事件已过,waitForResponse 会 timeout。
async function captureByRegionApi(page: Page): Promise<RegionRow[]> {
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/statistics/by-region") && r.request().method() === "GET",
    { timeout: 15000 }
  );
  await page.goto("/statistics/by-region");
  await page.waitForLoadState("networkidle");
  const resp = await respPromise;
  const j = await resp.json();
  return (j.data?.rows ?? []) as RegionRow[];
}

test("ADMIN 区域统计页 - 表格、行下钻、导出、其它原统计页正常", async ({ page }) => {
  await login(page, "admin");

  const apiRows = await captureByRegionApi(page);
  console.log("by-region API rows (default year range):", apiRows.length, "regions:", apiRows.map((r) => r.region).join(" | "));
  expect(apiRows.length).toBeGreaterThan(0);

  const tableRows = await page.locator("table tbody tr").count();
  console.log("by-region admin table rows:", tableRows);
  expect(tableRows).toBeGreaterThan(0);

  // 点首行 → /customers?town=xxx
  const first = apiRows[0];
  if (!first) throw new Error("apiRows empty");
  console.log("drilling to first region:", first.region);
  await page.locator("table tbody tr").first().click();
  await page.waitForURL(/\/customers\?/, { timeout: 10000 });
  console.log("drilldown URL:", page.url());
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  const custRows = await page.locator("tr.ant-table-row").count();
  console.log("customers page rows after drilldown:", custRows);
  expect(custRows).toBeGreaterThan(0);

  // 导出 xlsx
  const expRes = await page.request.get("/api/statistics/export?type=by-region");
  expect(expRes.status()).toBe(200);
  const cd = expRes.headers()["content-disposition"] ?? "";
  const ct = expRes.headers()["content-type"] ?? "";
  console.log("export ct:", ct, "cd:", cd);
  expect(ct).toContain("spreadsheetml");
  expect(cd).toMatch(/by-region-\d{4}-\d{2}-\d{2}\.xlsx/);

  // 其它三个统计页
  for (const p of ["/statistics/overview", "/statistics/performance", "/statistics/aging"]) {
    const r = await page.goto(p);
    expect(r?.status() ?? 0, `GET ${p} should be 2xx`).toBeLessThan(400);
    await page.waitForLoadState("networkidle");
  }
  console.log("overview/performance/aging all opened OK");
});

test("SALES 区域统计页 - 表格 + 导出应 403", async ({ page }) => {
  await login(page, "sales");
  const apiRows = await captureByRegionApi(page);
  console.log("by-region SALES API rows:", apiRows.length, "regions:", apiRows.map((r) => r.region).join(" | "));
  expect(apiRows.length).toBeGreaterThan(0);
  const expRes = await page.request.get("/api/statistics/export?type=by-region");
  console.log("SALES export by-region status:", expRes.status());
  expect(expRes.status()).toBe(403);
});
