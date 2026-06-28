// 场景 5：admin 发票 + 回款完整 UI 链路
// 用 API 快速准备客户/合同并发布，核心发票/回款动作走 UI，覆盖按钮权限与金额校验。
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const customerName = `E2E开票客户-${stamp}`;
const contractNo = `E2E-HT-${stamp}`;
const contractTitle = `E2E开票合同-${stamp}`;

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string, password: string) {
  // 先到 dashboard；未登录会被重定向到登录页，已登录则直接留下
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("请输入工号").fill(employeeNo);
    await page.getByPlaceholder("请输入密码").fill(password);
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
  }
}

async function createCustomer(page: import("@playwright/test").Page) {
  const res = await page.request.post("/api/customers", {
    data: {
      name: customerName,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13812345678"
    }
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.code).toBe(0);
  return body.data.id as string;
}

async function createAndPublishContract(page: import("@playwright/test").Page, customerId: string) {
  const signDate = new Date().toISOString();
  const startDate = new Date().toISOString();
  const endDate = new Date(Date.now() + 86400_000 * 30).toISOString();
  const res = await page.request.post("/api/contracts", {
    data: {
      customerId,
      contractNo,
      title: contractTitle,
      serviceType: "OTHER",
      signDate,
      startDate,
      endDate,
      totalAmount: 10000,
      taxRate: 0.06,
      paymentMethod: "LUMP_SUM",
      attachments: []
    }
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.code).toBe(0);
  const contractId = body.data.id as string;
  const pub = await page.request.post(`/api/contracts/${contractId}/publish`, { data: {} });
  expect(pub.ok()).toBeTruthy();
  return contractId;
}

test.describe.configure({ mode: "serial" });

test.describe("场景 5: admin 发票 + 回款完整 UI 链路", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "本链路仅在桌面 chromium 跑");
  let contractId = "";
  let invoiceId = "";
  let paymentId = "";

  test("5.1 登录并准备客户/合同", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    const customerId = await createCustomer(page);
    contractId = await createAndPublishContract(page, customerId);
    expect(contractId).toBeTruthy();
  });

  test("5.2 从 UI 新建开票", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto("/invoices/new");
    await page.waitForLoadState("networkidle");

    // 选合同（combobox 定位）
    await page.getByRole("combobox").first().click();
    await page.locator(".ant-select-item-option").filter({ hasText: contractNo }).first().click();
    // 等待客户信息回填
    await page.waitForTimeout(500);

    await page.getByLabel("发票号").fill(`011002100311${stamp.toString().slice(-8).padStart(8, "0")}`);
    await page.getByLabel("含税金额").fill("1000");
    await page.getByLabel("税号").fill("91330100MA2XXXXX00");

    // 提交
    await page.getByRole("button", { name: "创建开票" }).click();
    await page.waitForURL(/\/invoices\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 10000 });

    const url = page.url();
    invoiceId = url.split("/").pop() ?? "";
    expect(invoiceId).toBeTruthy();
  });

  test("5.3 发票详情提交并开票", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto(`/invoices/${invoiceId}`);
    await page.waitForLoadState("networkidle");

    // admin 可见提交按钮
    const submitBtn = page.getByRole("button", { name: /提\s*交/ });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();
    await page.waitForTimeout(800);

    // 开票按钮
    const issueBtn = page.getByRole("button", { name: /开\s*票/ });
    await expect(issueBtn).toBeVisible({ timeout: 5000 });
    await issueBtn.click();

    // 弹窗填发票号
    const modal = page.locator(".ant-modal").filter({ hasText: "开票(财务)" });
    await expect(modal).toBeVisible();
    const input = modal.locator("input");
    await input.fill(`011002100311${(stamp + 1).toString().slice(-8).padStart(8, "0")}`);
    await modal.locator(".ant-btn-primary").click();
    await page.waitForTimeout(800);

    // 状态变 ISSUED
    await expect(page.getByText("已开票").first()).toBeVisible({ timeout: 5000 });
  });

  test("5.4 从 UI 登记回款", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto(`/payments/new?contractId=${contractId}&invoiceId=${invoiceId}`);
    await page.waitForLoadState("networkidle");

    await page.getByLabel("金额").fill("1000");
    await page.getByLabel("到账日").fill("2026-06-23");
    await page.getByLabel("银行流水号").fill(`REF-${stamp}`);

    await page.getByRole("button", { name: "登记回款" }).click();
    await page.waitForURL(/\/payments\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 10000 });
    paymentId = page.url().split("/").pop() ?? "";
    expect(paymentId).toBeTruthy();
  });

  test("5.5 回款详情确认并对账", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto(`/payments/${paymentId}`);
    await page.waitForLoadState("networkidle");

    const confirmBtn = page.getByRole("button", { name: /财务确认/ });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // 确认弹窗填流水号
    const modal = page.locator(".ant-modal").filter({ hasText: "确认回款(财务)" });
    await expect(modal).toBeVisible();
    await modal.locator("input").fill(`REF-${stamp}`);
    await modal.locator(".ant-btn-primary").click();
    await page.waitForTimeout(800);

    // 对账
    const reconcileBtn = page.getByRole("button", { name: /对\s*账/ });
    await expect(reconcileBtn).toBeVisible({ timeout: 5000 });
    await reconcileBtn.click();
    await page.waitForTimeout(800);

    await expect(page.getByText("已对账").first()).toBeVisible({ timeout: 5000 });
  });
});
