import { chromium } from "playwright";
import fs from "fs";

const OUT = "/tmp/qt-shots";
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "customers", path: "/customers" },
  { name: "contracts", path: "/contracts" },
  { name: "projects", path: "/projects" },
  { name: "invoices", path: "/invoices" },
  { name: "payments", path: "/payments" },
  { name: "statistics-overview", path: "/statistics/overview" },
  { name: "statistics-aging", path: "/statistics/aging" },
  { name: "statistics-performance", path: "/statistics/performance" },
  { name: "messages", path: "/messages" },
  { name: "announcements", path: "/announcements" },
  { name: "admin-users", path: "/admin/users" },
  { name: "admin-roles", path: "/admin/roles" },
  { name: "admin-dictionaries", path: "/admin/dictionaries" },
  { name: "admin-operation-logs", path: "/admin/operation-logs" },
  { name: "not-found", path: "/totally-bogus-path-here" }
];

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});
const page = await ctx.newPage();

// Login first
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.locator('input[name="employeeNo"]').clear();
await page.locator('input[name="employeeNo"]').fill("admin");
await page.locator('input[name="password"]').clear();
await page.locator('input[name="password"]').fill("123456");
await Promise.all([
  page.waitForURL(/\/dashboard|\/$/, { timeout: 20000 }),
  page.click('button[type="submit"]')
]);
await page.waitForTimeout(500);

let pass = 0, fail = 0;
for (const r of ROUTES) {
  const file = `${OUT}/after-${r.name}.png`;
  try {
    const resp = await page.goto(`http://localhost:3000${r.path}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`OK   ${resp ? resp.status() : "?"}  ${r.path}  ->  ${file}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${r.path}  ->  ${e.message}`);
    fail++;
  }
}

// Detail pages (need a real id)
const det = [
  { name: "detail-customer", path: null },
  { name: "detail-contract", path: null },
  { name: "detail-project", path: null },
  { name: "detail-invoice", path: null },
  { name: "detail-payment", path: null }
];
const ids = {
  customer: null,
  contract: null,
  project: null,
  invoice: null,
  payment: null
};
for (const k of Object.keys(ids)) {
  const r = await page.request.get(`http://localhost:3000/api/${k}s?pageSize=1`);
  const j = await r.json();
  ids[k] = j?.data?.list?.[0]?.id;
  console.log(`id[${k}]=${ids[k]}`);
}

const nameToKey = {
  "detail-customer": "customer",
  "detail-contract": "contract",
  "detail-project": "project",
  "detail-invoice": "invoice",
  "detail-payment": "payment"
};

for (const d of det) {
  const id = ids[nameToKey[d.name]];
  if (!id) {
    console.log(`SKIP ${d.name}  no id`);
    continue;
  }
  const path = `/${nameToKey[d.name]}s/${id}`;
  try {
    const resp = await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/after-${d.name}.png`, fullPage: false });
    console.log(`OK   ${resp ? resp.status() : "?"}  ${path}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${d.name}  ${e.message}`);
    fail++;
  }
}

// Forms
const forms = [
  { name: "form-customer-new", path: "/customers/new" },
  { name: "form-contract-new", path: "/contracts/new" }
];
for (const f of forms) {
  try {
    const resp = await page.goto(`http://localhost:3000${f.path}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/after-${f.name}.png`, fullPage: false });
    console.log(`OK   ${resp ? resp.status() : "?"}  ${f.path}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${f.name}  ${e.message}`);
    fail++;
  }
}

await browser.close();
console.log(`=====  PASS=${pass}  FAIL=${fail}  =====`);
