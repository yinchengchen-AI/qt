// 合同管理 - 交付物附件 (Attachment.isDeliverable) E2E
// 覆盖 spec §5 (合同管理) + §10 (权限回归) 中关于交付物附件上传 / 查看
//
// 流程:
//   1) admin 用 API 创建一个 DRAFT 合同 (无 deliverables JSON 字段)
//   2) admin 打开详情 → 切到"交付物" tab → 看到"暂无上传文件" + "上传"按钮
//   3) 切到 finance 登录 → 同样合同 → 切到"交付物" tab → 看不到"上传"按钮, 看到权限提示
//
// 跑法: npm run dev:setup 起来后, npm run test:e2e -- 07-contract-deliverable-attachments
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const contractNo = `E2E-DELIV-${stamp}`;

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

// 通过 API 创建一个简单 DRAFT 合同 (无 deliverables 字段)
async function createContractViaApi(request: APIRequestContext, adminCookie: string) {
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
      title: `E2E交付物测试合同-${stamp}`,
      serviceType: "OTHER",
      signDate: "2026-06-01T00:00:00.000Z",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-12-31T00:00:00.000Z",
      totalAmount: 10000,
      taxRate: 0.06,
      paymentMethod: "LUMP_SUM",
      // 不传 signerId/ownerUserId: service 层用 admin 当前用户做 fallback
      attachments: []
    }
  });
  const contractJson = await contractRes.json();
  expect(contractJson.code, `POST /api/contracts body: ${JSON.stringify(contractJson)}`).toBe(0);
  return contractJson.data.id as string;
}

async function getSessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const found = cookies.find((c) => c.name === "next-auth.session-token" || c.name === "__Secure-next-auth.session-token");
  if (!found) throw new Error("未找到 next-auth session cookie; 请先 ensureLoggedIn");
  return `${found.name}=${found.value}`;
}

test.describe.serial("07 - 合同交付物附件", () => {
  let testContractId = "";

  test("07.0 admin 通过 API 创建 DRAFT 合同 (无结构化 deliverables)", async ({ page, request }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    const cookie = await getSessionCookie(page);
    testContractId = await createContractViaApi(request, cookie);
    expect(testContractId).toBeTruthy();
  });

  test("07.1 admin 打开合同详情, 交付物 tab 渲染空状态 + 上传按钮", async ({ page }) => {
    await ensureLoggedIn(page, "admin", DEV_PASSWORD);
    await page.goto(`/contracts/${testContractId}`);
    await page.waitForLoadState("networkidle");
    // 切到"交付物" tab
    await page.getByRole("tab", { name: /交付物/ }).click();
    // 看到空状态文案
    await expect(page.getByText(/暂无上传文件/)).toBeVisible({ timeout: 10000 });
    // 看到"上传"按钮 (admin 永远能管)
    const uploadButtons = page.getByRole("button", { name: /^上传$/ });
    expect(await uploadButtons.count()).toBeGreaterThanOrEqual(1);
  });

  test("07.2 finance 看不到上传按钮 (只读 + 权限提示)", async ({ page }) => {
    await ensureLoggedIn(page, "finance", DEV_PASSWORD);
    await page.goto(`/contracts/${testContractId}`);
    await page.waitForLoadState("networkidle");
    // finance 没有 CONTRACT.UPDATE, 详情页会 403
    const tab = page.getByRole("tab", { name: /交付物/ });
    if (await tab.count() > 0 && await tab.first().isVisible().catch(() => false)) {
      await tab.first().click();
      const uploadButtons = page.getByRole("button", { name: /^上传$/ });
      // 不应该有"上传"按钮
      expect(await uploadButtons.count()).toBe(0);
      // 应看到权限提示
      await expect(page.getByText(/仅管理员.*签订人.*负责人/)).toBeVisible({ timeout: 5000 });
    } else {
      // 直接被 403 拒绝, 视为正确
      await expect(page.getByText(/无权限|403|Forbidden/)).toBeVisible({ timeout: 5000 });
    }
  });
});
