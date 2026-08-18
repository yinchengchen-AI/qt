// 场景 18：续签跟进 + 联动补盲 E2E (Phase 1.5 / Phase 3)
//
// 覆盖:
//   1) 工作台到期待办旁「续签」按钮 → RenewalModal 打开并预填源合同
//   2) 提交续签 → 创建成功 → 源合同待办消失 (服务端按 renewal 排除)
//   3) 详情页概览: 续签链「续签自 / 续签至」链接双向可见
//   4) 详情页概览: 开票/回款双进度条渲染
//   5) 详情页概览: 超期未开票合同显示预警 Alert
//
// 数据: prisma 直造 fixture (ACTIVE 合同, 无需走上传审批流), TAG 前缀自清理.
// 登录态走 _auth.ts 进程内共享 (proxy.ts 限流 5 次/分钟/IP).
// 桌面交互用例在移动端 project 跳过 (移动端由 16.5/17.4 专项覆盖).
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { loginCookiesOnce } from "./_auth";

const TAG = `E2E-REN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const DAY_MS = 86_400_000;
let salesId = "";
let customerId = "";
let expiringContractId = "";
let expiringContractNo = "";
let noInvoiceContractId = "";
let renewalContractNo = "";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "sales");
  const sales = await prisma.user.findFirst({
    where: { employeeNo: "sales", deletedAt: null },
    select: { id: true }
  });
  if (!sales) throw new Error("seed sales user not found");
  salesId = sales.id;
  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000555",
      ownerUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  customerId = cust.id;
  const now = Date.now();
  // 3 天后到期 → expiring 待办 (带续签按钮)
  const c1 = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-EXP`,
      customerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-临期合同`,
      serviceType: "OTHER",
      signDate: new Date(now - 360 * DAY_MS),
      startDate: new Date(now - 360 * DAY_MS),
      endDate: new Date(now + 3 * DAY_MS),
      totalAmount: 50000,
      taxRate: 0.06,
      taxAmount: Number((50000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((50000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesId,
      signerId: salesId,
      attachments: [],
      createdById: salesId,
      updatedById: salesId
    }
  });
  expiringContractId = c1.id;
  expiringContractNo = c1.contractNo;
  // 生效 50 天无发票 → 详情页超期未开票 Alert
  const c2 = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-NOINV`,
      customerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-未开票合同`,
      serviceType: "OTHER",
      signDate: new Date(now - 50 * DAY_MS),
      startDate: new Date(now - 50 * DAY_MS),
      endDate: new Date(now + 300 * DAY_MS),
      totalAmount: 30000,
      taxRate: 0.06,
      taxAmount: Number((30000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((30000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesId,
      signerId: salesId,
      attachments: [],
      createdById: salesId,
      updatedById: salesId
    }
  });
  noInvoiceContractId = c2.id;
});

test.afterAll(async () => {
  const ids = [expiringContractId, noInvoiceContractId].filter(Boolean);
  // 续签创建的合同 (renewedFromId = expiringContractId) 也一并清理
  const renewals = await prisma.contract.findMany({ where: { renewedFromId: { in: ids } }, select: { id: true } });
  const allIds = [...ids, ...renewals.map((r) => r.id)];
  await prisma.contract.deleteMany({ where: { id: { in: allIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function loginAsSales(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "sales");
  await page.context().addCookies(cookies);
}

test.describe.serial("场景 18: 续签 + 联动补盲 E2E", () => {
  test("18.1 到期待办显示「续签」按钮, 点击打开预填 Modal", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    // fixture 合同同时产生 expiring + no_invoice 两条待办 (都含合同号);
    // 续签按钮只在 expiring/overdue 行, 按按钮收窄定位
    const row = page.getByRole("listitem").filter({ hasText: expiringContractNo }).filter({ has: page.getByRole("button", { name: /^\s*续\s*签$/ }) });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.getByRole("button", { name: /^\s*续\s*签$/ }).click();
    // Modal 打开, 标题含源合同号, 标题字段预填"（续签）"
    await expect(page.getByText(`续签合同（源：${expiringContractNo}）`)).toBeVisible({ timeout: 15000 });
    const titleInput = page.locator(".ant-modal input#title");
    await expect(titleInput).toHaveValue(/（续签）/);
  });

  test("18.2 提交续签 → 创建成功 → 源合同待办消失", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    const row = page.getByRole("listitem").filter({ hasText: expiringContractNo }).filter({ has: page.getByRole("button", { name: /^\s*续\s*签$/ }) });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.getByRole("button", { name: /^\s*续\s*签$/ }).click();
    await expect(page.getByText(`续签合同（源：${expiringContractNo}）`)).toBeVisible({ timeout: 15000 });
    renewalContractNo = `${TAG}-REN`;
    await page.locator(".ant-modal input#contractNo").fill(renewalContractNo);
    await page.getByRole("button", { name: "创建续签" }).click();
    await expect(page.getByText("续签合同已创建", { exact: false })).toBeVisible({ timeout: 15000 });
    // 续签创建后源合同的 expiring 待办消失 (no_invoice 语义独立, 保留)
    await expect(
      page.getByRole("listitem").filter({ hasText: expiringContractNo }).filter({ hasText: "即将到期" })
    ).toHaveCount(0, { timeout: 15000 });
  });

  test("18.3 详情页续签链双向链接", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    // 源合同详情: 概览 tab 显示「续签至」
    await page.goto(`/contracts/${expiringContractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("续签至：")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("link", { name: renewalContractNo })).toBeVisible();
    // 续签合同详情: 显示「续签自」
    const renewal = await prisma.contract.findFirst({ where: { contractNo: renewalContractNo } });
    await page.goto(`/contracts/${renewal!.id}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("续签自：")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("link", { name: expiringContractNo })).toBeVisible();
  });

  test("18.4 详情页概览双进度条渲染", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${expiringContractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("开票状态")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("回款状态")).toBeVisible();
    // 开票/回款 ProCard 各一条 Progress
    await expect(page.locator(".ant-progress")).toHaveCount(2);
  });

  test("18.5 超期未开票合同详情页显示预警 Alert", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${noInvoiceContractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("该合同生效已超过 30 天，仍无已开票发票")).toBeVisible({ timeout: 30000 });
    // 无偏差的合同不出偏差 Alert
    await expect(page.getByText("开票-回款偏差超过 20%")).toHaveCount(0);
  });
});
