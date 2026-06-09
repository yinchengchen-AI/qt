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
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/qt-shots/after-dashboard-v2.png", fullPage: false });

await page.goto("http://localhost:3000/customers", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/qt-shots/after-customers-v2.png", fullPage: false });

await page.goto("http://localhost:3000/contracts", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/qt-shots/after-contracts-v2.png", fullPage: false });

await browser.close();
console.log("ok");
