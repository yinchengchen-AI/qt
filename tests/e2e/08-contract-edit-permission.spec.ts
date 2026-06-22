// 合同管理 - 编辑权限 E2E
//
// 覆盖:
//   1) admin 创建的 ACTIVE 合同,详情页显示"编辑"按钮
//   2) SALES(非 admin)打开同一合同的编辑页,应看到"不可编辑"提示
//
// 跑法: npm run dev:setup 起来后, npm run test:e2e -- 08-contract-edit-permission
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const contractNo = `E2E-EDIT-PERM-${stamp}`;

async function ensureLoggedIn(page: Page, employeeNo: string, password: string) {
  if (page.url().includes("/dashboard")) return;
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByPlaceholder("请输入工号").fill(employeeNo);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
}

async function getSessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const found = cookies.find((c) => c.name === "next-auth.session-token" || c.name === "__Secure-next-auth.session-token");
  if (!found) throw new Error("未找到 next-auth session cookie; 请先 ensureLoggedIn");
  return `${found.name}=${found.value}`;
}

async function createAndPublishContract(request: APIRequestContext, adminCookie: string) {
  const customersRes = await request.get("/api/customers?page=1&pageSize=1", {
    headers: { cookie: adminCookie }
  });
  expect(customersRes.status(), "list customers").toBe(200);
  const customersJson = await customersRes.json();
  const customer = customersJson?.data?.list?.[0] ?? customersJson?.data?.items?.[0] ?? null;
  expect(customer, "应能找到 seed 客户").toBeTruthy();

  const contractRes = await request.post("/api/contracts", {
    headers: { cookie: adminCookie, "content-type": "application/json" },
    data: {
      contractNo,
      customerId: customer.id,
      title: `E2E编辑权限测试合同-${stamp}`,
      serviceType: "OTHER",
      signDate: "2026-06-01T00:00:00.000Z",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-12-31T00:00:00.000Z",
      totalAmount: 10000,
      taxRate: 0.06,
      paymentMethod: "LUMP_SUM",
      attachments: []
    }
  });
  const contractJson = await contractRes.json();
  expect(contractJson.code, `POST /api/contracts body: ${JSON.stringify(contractJson)}`).toBe(0);
  const contractId = contractJson.data.id as string;

  const publishRes = await request.post(`/api/contracts/${contractId}/publish`, {
    headers: { cookie: adminCookie }
  });
  const publishJson = await publishRes.json();
  expect(publishJson.code, `publish contract: ${JSON.stringify(publishJson)}`).toBe(0);

  return contractId;
}

test.describe.serial("08 - 合同编辑权限", () => {
  let testContractId = "";

  test("08.0 admin 创建并发布合同", async ({ page, request }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    const cookie = await getSessionCookie(page);
    testContractId = await createAndPublishContract(request, cookie);
    expect(testContractId).toBeTruthy();
  });

  test("08.1 admin 详情页显示编辑按钮", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto(`/contracts/${testContractId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "编辑" })).toBeVisible({ timeout: 10000 });
  });

  test("08.2 SALES 打开编辑页看到不可编辑提示", async ({ page }) => {
    await ensureLoggedIn(page, "sales", DEV_PASSWORD);
    await page.goto(`/contracts/${testContractId}/edit`);
    await page.waitForLoadState("networkidle");
    // 编辑页在非 admin / 非 DRAFT 状态下会展示状态不可编辑的提示
    await expect(page.getByText(/当前状态.*不可编辑/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "保存修改" })).not.toBeVisible();
  });
});
