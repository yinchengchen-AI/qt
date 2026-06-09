import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[name="employeeNo"]', "admin");
await page.fill('input[name="password"]', "123456");
await Promise.all([
  page.waitForURL(/\/dashboard|\/$/, { timeout: 20000 }),
  page.click('button[type="submit"]')
]);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(2000);
const html = await page.content();
const hasTestId = html.includes('data-testid="stat-grid"');
const hasProCard = html.includes('ant-pro-card');
const hasH1 = await page.locator('h1').first().textContent();
const statCount = await page.locator('[data-testid="stat-grid"]').count();
console.log({ hasTestId, hasProCard, hasH1, statCount });
await page.screenshot({ path: "/tmp/qt-shots/dash-inspect.png" });
await browser.close();
