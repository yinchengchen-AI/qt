import { expect, test, type Page } from "@playwright/test";
import { loginCookiesOnce } from "./_auth";
import { localReportFixture } from "../fixtures/business-report";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "finance");
});

async function ensureLoggedIn(page: Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "finance");
  await page.context().addCookies(cookies);
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
}

test("工作台不自动请求, 点击后生成且切换区间清空旧结果", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/statistics/ai-report") requests.push(req.url());
  });
  await page.route("**/api/statistics/ai-report?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      data: {
        summary: "经营摘要",
        keyFindings: ["发现一"],
        recommendations: ["建议一"],
        generatedAt: "2026-11-01T00:00:00.000Z",
        source: "AI",
        model: "deepseek-chat",
        cached: false,
        notice: null
      }
    })
  }));

  await ensureLoggedIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "业务总览" })).toBeVisible();
  expect(requests).toEqual([]);

  await page.getByRole("button", { name: "生成经营解读" }).click();
  await expect(page.getByText("经营摘要", { exact: true })).toBeVisible();
  expect(new URL(requests[0]!).searchParams.get("range")).toBe("month");

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(new URL(requests[1]!).searchParams.get("force")).toBe("1");

  await page.getByText("季度", { exact: true }).click();
  await expect(page.getByText("经营摘要", { exact: true })).toHaveCount(0);
});

test("统计页明确展示规则降级", async ({ page }) => {
  await page.route("**/api/statistics/ai-report?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      data: {
        ...localReportFixture,
        notice: "AI 解读暂不可用，当前展示规则摘要"
      }
    })
  }));

  await ensureLoggedIn(page);
  await page.goto("/statistics/overview");
  const reportResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/statistics/ai-report"
  );
  const generateButton = page.getByRole("button", { name: "生成经营解读" });
  await generateButton.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "auto" });
  });
  await generateButton.click();
  expect((await reportResponse).status()).toBe(200);
  await expect(page.getByText("规则经营摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("规则摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 解读暂不可用，当前展示规则摘要", { exact: true })).toBeVisible();
});
