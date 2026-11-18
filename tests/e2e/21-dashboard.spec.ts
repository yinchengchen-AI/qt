import { test, expect } from "@playwright/test";
import { loginCookiesOnce } from "./_auth";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "finance");
});

async function ensureLoggedIn(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "finance");
  await page.context().addCookies(cookies);
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
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

  await expect(page.getByText("业务总览", { exact: true })).toBeVisible();
  for (const label of ["催收中", "法务介入", "已联系", "客户承诺", "争议"]) {
    await expect(page.getByText(label, { exact: false })).toHaveCount(0);
  }
  expect(dunningRequests).toEqual([]);
});
