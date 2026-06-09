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

const h1Count = await page.locator("h1").count();
const headings = await page.locator("h1").allTextContents();
console.log({ h1Count, headings });

const allHeadings = await page.getByRole("heading").allTextContents();
console.log({ allHeadings });

// Try getByRole
const heading = page.getByRole("heading", { name: "工作台" });
const visible = await heading.isVisible();
console.log({ visible, count: await heading.count() });
await browser.close();
