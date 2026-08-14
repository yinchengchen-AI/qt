// 业绩排行页(原区域统计并入)综合验证:维度切换 / 表格 / 行点击下钻 / 导出 xlsx / SALES 导出 403。
// 注意:业绩排行页用的是原生 <table>(性能/样式可控),不是 antd ProTable,所以选择器走 tbody tr。
// 不用 networkidle(消息轮询等长连接会让它不 settle),统一等具体响应/元素。
// 区域数据自建 fixture(客户 + 已发布合同,余杭区/瓶窑镇 — 与 china-divisions 树一致,
// 保证 /customers 下钻时 cascader 能解析路径),不依赖环境里的存量数据。
import { test, expect, type Page } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const FIXTURE_DISTRICT = "余杭区";
const FIXTURE_TOWN = "瓶窑镇";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByPlaceholder("工号", { exact: true }).fill(user);
  await page.getByPlaceholder("密码", { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "登 录", exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await dismissReleasePopup(page);
}

// 登录后若有未读 AppRelease 会弹「新版本」窗(异步拉取,可能跳转后才出现),
// 点「已了解」关掉(顺手标记已读,本 session 不再弹);没有则快速跳过。
async function dismissReleasePopup(page: Page) {
  const btn = page.getByRole("button", { name: "已了解" });
  try {
    await btn.waitFor({ state: "visible", timeout: 3000 });
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  } catch { /* 没有弹窗 */ }
}

// 自建区域 fixture:客户(带 district/town) + 发布合同,让区域排行出现一行非零数据
async function createRegionFixture(page: Page) {
  const custRes = await page.request.post("/api/customers", {
    data: {
      name: `E2E区域客户-${stamp}`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      district: FIXTURE_DISTRICT,
      town: FIXTURE_TOWN,
      contactPhone: "13812345678"
    }
  });
  expect(custRes.ok()).toBeTruthy();
  const custBody = await custRes.json();
  expect(custBody.code).toBe(0);
  const customerId = custBody.data.id as string;

  const now = Date.now();
  const contractRes = await page.request.post("/api/contracts", {
    data: {
      customerId,
      contractNo: `E2E-REGION-${stamp}`,
      title: `E2E区域合同-${stamp}`,
      serviceType: "OTHER",
      signDate: new Date(now).toISOString(),
      startDate: new Date(now).toISOString(),
      endDate: new Date(now + 86400_000 * 30).toISOString(),
      totalAmount: 10000,
      taxRate: 0.06,
      paymentMethod: "LUMP_SUM",
      attachments: []
    }
  });
  expect(contractRes.ok()).toBeTruthy();
  const contractBody = await contractRes.json();
  expect(contractBody.code).toBe(0);
  const pub = await page.request.post(`/api/contracts/${contractBody.data.id}/publish`, { data: {} });
  expect(pub.ok()).toBeTruthy();
}

type RankingRow = { key: string; name: string; district?: string | null; town?: string | null };

// 打开业绩排行页并切到「按区域」维度,抓 /api/statistics/performance?dimension=region 响应。
// waitForResponse 必须在触发请求的 click 之前注册,否则事件已过会 timeout。
async function captureRegionRanking(page: Page): Promise<RankingRow[]> {
  await page.goto("/statistics/performance");
  // 版本弹窗是异步拉的,跳转后仍可能迟到,再兜一次
  await dismissReleasePopup(page);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/statistics/performance") && r.url().includes("dimension=region") && r.request().method() === "GET",
    { timeout: 15000 }
  );
  await page.getByText("按区域", { exact: true }).click();
  const resp = await respPromise;
  const j = await resp.json();
  expect(j.code).toBe(0);
  return (j.data?.rows ?? []) as RankingRow[];
}

test("ADMIN 业绩排行页 - 区域维度表格、行下钻、导出、其它原统计页正常", async ({ page }) => {
  await login(page, "admin");
  await createRegionFixture(page);

  const apiRows = await captureRegionRanking(page);
  console.log("performance region API rows:", apiRows.length, "regions:", apiRows.map((r) => r.name).join(" | "));
  const fixtureRow = apiRows.find((r) => r.district === FIXTURE_DISTRICT && r.town === FIXTURE_TOWN);
  expect(fixtureRow, "区域排行应包含 fixture 所在镇街").toBeTruthy();

  await page.locator("table tbody tr").first().waitFor({ timeout: 10000 });
  const tableRows = await page.locator("table tbody tr").count();
  console.log("performance region table rows:", tableRows);
  expect(tableRows).toBeGreaterThan(0);

  // 点 fixture 所在行 → /customers?district=&town=,等带过滤参数的客户列表响应回来再数行
  const custRespPromise = page.waitForResponse(
    (r) => r.url().includes("/api/customers?") && r.url().includes("district=") && r.request().method() === "GET",
    { timeout: 15000 }
  );
  await page.locator("table tbody tr", { hasText: FIXTURE_TOWN }).first().click();
  await page.waitForURL(/\/customers\?/, { timeout: 10000 });
  console.log("drilldown URL:", page.url());
  const custResp = await custRespPromise;
  const custJson = await custResp.json();
  const custTotal: number = custJson.data?.total ?? 0;
  await page.locator("tr.ant-table-row").first().waitFor({ timeout: 10000 });
  const custRows = await page.locator("tr.ant-table-row").count();
  console.log("customers page rows after drilldown:", custRows, "api total:", custTotal);
  expect(custRows).toBeGreaterThan(0);
  expect(custTotal).toBeGreaterThan(0);

  // 导出 xlsx (新统一排行导出,region 维度)
  const expRes = await page.request.get("/api/statistics/export?type=performance&dimension=region");
  expect(expRes.status()).toBe(200);
  const cd = expRes.headers()["content-disposition"] ?? "";
  const ct = expRes.headers()["content-type"] ?? "";
  console.log("export ct:", ct, "cd:", cd);
  expect(ct).toContain("spreadsheetml");
  // 业绩排行_region_YYYY-MM-DD_HHmm.xlsx(ASCII 兜底把中文替换成下划线)
  expect(cd).toMatch(/_region_\d{4}-\d{2}-\d{2}(_\d{4})?\.xlsx/);

  // 旧 by-region 导出仍兼容
  const legacyRes = await page.request.get("/api/statistics/export?type=by-region");
  expect(legacyRes.status()).toBe(200);

  // 其它统计页
  for (const p of ["/statistics/overview", "/statistics/aging"]) {
    const r = await page.goto(p);
    expect(r?.status() ?? 0, `GET ${p} should be 2xx`).toBeLessThan(400);
  }
  console.log("overview/aging all opened OK");
});

test("SALES 业绩排行页 - 区域维度接口正常 + 导出应 403", async ({ page }) => {
  await login(page, "sales");
  // 行级隔离口径由 tests/api/statistics-performance.test.ts 覆盖;这里只验证页面/接口可用
  const apiRows = await captureRegionRanking(page);
  console.log("performance region SALES API rows:", apiRows.length, "regions:", apiRows.map((r) => r.name).join(" | "));
  const expRes = await page.request.get("/api/statistics/export?type=performance&dimension=region");
  console.log("SALES export performance status:", expRes.status());
  expect(expRes.status()).toBe(403);
});
