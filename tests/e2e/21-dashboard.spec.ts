import { test, expect, type Page, type Route } from "@playwright/test";
import type { DashboardSummary } from "@/lib/types/dashboard";
import { loginCookiesOnce } from "./_auth";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "finance");
});

async function ensureLoggedIn(page: Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "finance");
  await page.context().addCookies(cookies);
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
}

function summaryFixture(customerTotal: number): DashboardSummary {
  return {
    overview: {
      contractAmount: 120000,
      invoiceAmount: 80000,
      paymentAmount: 50000,
      unpaidAmount: 30000,
      invoiceRate: 66.67,
      paymentRate: 62.5,
      contractCount: 2,
      invoiceCount: 3,
      paymentCount: 4,
      range: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-30T23:59:59.999Z" }
    },
    agingBuckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    customers: { total: customerTotal, newInRange: 3 },
    contracts: { byStatus: [] },
    invoices: { total: 3, byStatus: [], pending: 0 },
    payments: { total: 4, byStatus: [] },
    topCustomers: [],
    townDistribution: []
  };
}

async function fulfillSummary(route: Route, summary: DashboardSummary) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: summary })
  });
}

async function fulfillSummaryError(route: Route, message: string) {
  await route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ code: 500, errorCode: "INTERNAL_ERROR", message })
  });
}

test("21.1 Dashboard 不展示催收状态且不请求催收汇总", async ({ page }) => {
  const dunningRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/statistics/aging/dunning/summary") {
      dunningRequests.push(request.url());
    }
  });

  await ensureLoggedIn(page);
  const summaryResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary" && response.status() === 200
  );
  await page.goto("/dashboard");
  await summaryResponse;

  await expect(page.getByText("客户总数", { exact: true })).toBeVisible();
  for (const label of ["催收中", "法务介入", "已联系", "客户承诺", "争议"]) {
    await expect(page.getByText(label, { exact: false })).toHaveCount(0);
  }
  expect(dunningRequests).toEqual([]);
});

test("21.2 首次汇总 500 显示错误并可重试恢复", async ({ page }) => {
  let monthAttempts = 0;
  await page.route("**/api/dashboard/summary?**", async (route) => {
    monthAttempts += 1;
    if (monthAttempts === 1) {
      await fulfillSummaryError(route, "首次汇总失败");
      return;
    }
    await fulfillSummary(route, summaryFixture(12));
  });

  await ensureLoggedIn(page);
  const failedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary" && response.status() === 500
  );
  await page.goto("/dashboard");
  await failedResponse;

  await expect(page.getByText("首次汇总失败", { exact: true })).toBeVisible();
  const retryResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary" && response.status() === 200
  );
  await page.getByRole("button", { name: /重\s*试/ }).click();
  await retryResponse;

  await expect(page.getByText("客户总数", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("12", { exact: true })).toBeVisible();
  expect(monthAttempts).toBe(2);
});

test("21.3 月度成功后季度 500 保留旧 KPI 并提示，重试刷新当前区间", async ({ page }) => {
  let quarterAttempts = 0;
  await page.route("**/api/dashboard/summary?**", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range");
    if (range === "quarter") {
      quarterAttempts += 1;
      if (quarterAttempts === 1) {
        await fulfillSummaryError(route, "季度汇总失败");
        return;
      }
      await fulfillSummary(route, summaryFixture(34));
      return;
    }
    await fulfillSummary(route, summaryFixture(12));
  });

  await ensureLoggedIn(page);
  const monthResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary"
      && new URL(response.url()).searchParams.get("range") === "month"
      && response.status() === 200
  );
  await page.goto("/dashboard");
  await monthResponse;
  await expect(page.getByRole("main").getByText("12", { exact: true })).toBeVisible();

  const quarterFailure = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary"
      && new URL(response.url()).searchParams.get("range") === "quarter"
      && response.status() === 500
  );
  await page.getByText("季度", { exact: true }).click();
  await quarterFailure;

  await expect(page.getByText("数据刷新失败，当前展示上次成功结果", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("12", { exact: true })).toBeVisible();

  const quarterRetry = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary"
      && new URL(response.url()).searchParams.get("range") === "quarter"
      && response.status() === 200
  );
  await page.getByRole("button", { name: /重\s*试/ }).click();
  await quarterRetry;

  await expect(page.getByRole("main").getByText("34", { exact: true })).toBeVisible();
  await expect(page.getByText("数据刷新失败，当前展示上次成功结果", { exact: true })).toHaveCount(0);
  expect(quarterAttempts).toBe(2);
});

test("21.4 季度延迟时保留旧内容并显示数据更新中", async ({ page }) => {
  let releaseQuarter: (() => void) | undefined;
  const quarterGate = new Promise<void>((resolve) => {
    releaseQuarter = resolve;
  });
  await page.route("**/api/dashboard/summary?**", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range");
    if (range === "quarter") {
      await quarterGate;
      await fulfillSummary(route, summaryFixture(34));
      return;
    }
    await fulfillSummary(route, summaryFixture(12));
  });

  await ensureLoggedIn(page);
  const monthResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary"
      && new URL(response.url()).searchParams.get("range") === "month"
      && response.status() === 200
  );
  await page.goto("/dashboard");
  await monthResponse;
  await expect(page.getByRole("main").getByText("12", { exact: true })).toBeVisible();

  const quarterRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/dashboard/summary"
      && new URL(request.url()).searchParams.get("range") === "quarter"
  );
  await page.getByText("季度", { exact: true }).click();
  await quarterRequest;

  await expect(page.getByRole("main").getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("数据更新中", { exact: true })).toBeVisible();

  const quarterResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/dashboard/summary"
      && new URL(response.url()).searchParams.get("range") === "quarter"
      && response.status() === 200
  );
  releaseQuarter!();
  await quarterResponse;

  await expect(page.getByRole("main").getByText("34", { exact: true })).toBeVisible();
  await expect(page.getByText("数据更新中", { exact: true })).toHaveCount(0);
});
