// 场景 20：移动端适配 + PWA E2E (Phase 5)
//
// 覆盖:
//   1) PWA: /manifest.webmanifest 可达且含名称/图标; /sw.js 可达
//   2) 手机端工作台统计卡 2×2 网格 (ant-col-xs-12)
//   3) 手机端底部固定导航可见, 消息项可跳转 /messages
//   4) 手机端合同详情「风险分析」区块渲染条形图降级 (canvas 存在, 非雷达)
//   5) iPad 竖屏工作台布局正常
//
// 数据: prisma 直造 fixture (详情页用 ACTIVE 合同), TAG 前缀自清理.
// 登录态走 _auth.ts 进程内共享. 移动端用例在非移动 project 跳过.
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { loginCookiesOnce } from "./_auth";

const TAG = `E2E-MOB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const DAY_MS = 86_400_000;
let customerId = "";
let contractId = "";

test.beforeAll(async ({ browser }) => {
  await loginCookiesOnce(browser, "sales");
  const sales = await prisma.user.findFirst({
    where: { employeeNo: "sales", deletedAt: null },
    select: { id: true }
  });
  if (!sales) throw new Error("seed sales user not found");
  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000333",
      ownerUserId: sales.id,
      createdById: sales.id,
      updatedById: sales.id
    }
  });
  customerId = cust.id;
  const now = Date.now();
  const c = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-C`,
      customerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-移动合同`,
      serviceType: "OTHER",
      signDate: new Date(now - 60 * DAY_MS),
      startDate: new Date(now - 60 * DAY_MS),
      endDate: new Date(now + 300 * DAY_MS),
      totalAmount: 60000,
      taxRate: 0.06,
      taxAmount: Number((60000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((60000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: sales.id,
      signerId: sales.id,
      attachments: [],
      createdById: sales.id,
      updatedById: sales.id
    }
  });
  contractId = c.id;
});

test.afterAll(async () => {
  if (contractId) await prisma.contract.deleteMany({ where: { id: contractId } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function loginAsSales(page: import("@playwright/test").Page) {
  const cookies = await loginCookiesOnce(page.context().browser()!, "sales");
  await page.context().addCookies(cookies);
}

test.describe("场景 20: 移动端 + PWA", () => {
  test("20.1 PWA manifest 与 Service Worker 可达", async ({ page }) => {
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const body = await manifest.json();
    expect(body.name).toContain("企泰安全");
    expect(body.display).toBe("standalone");
    expect(body.icons.length).toBeGreaterThan(0);
    const sw = await page.request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect((await sw.text()).length).toBeGreaterThan(100);
  });

  test("20.2 手机端工作台统计卡 2×2 网格", async ({ page, isMobile }) => {
    test.skip(!isMobile, "移动端用例");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("我的活跃合同")).toBeVisible({ timeout: 30000 });
    // mobileColumns=2 → ant-col-xs-12 (半宽); 4 张卡都应是半宽
    const halfCols = page.locator(".ant-col-xs-12");
    expect(await halfCols.count()).toBeGreaterThanOrEqual(4);
  });

  test("20.3 手机端底部导航可见且消息项可跳转", async ({ page, isMobile }) => {
    // 底部导航仅 isPhone (<576px) 渲染; ipad project (820px) 虽是 isMobile 但走侧边栏
    test.skip(!isMobile || (page.viewportSize()?.width ?? 999) >= 600, "仅手机断点");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    const nav = page.locator("nav").last();
    await expect(nav.getByText("工作台")).toBeVisible({ timeout: 30000 });
    await expect(nav.getByText("合同", { exact: true })).toBeVisible();
    await nav.getByText("消息").click();
    await page.waitForURL(/\/messages$/, { timeout: 15000 });
    await expect(page.getByText("消息中心").first()).toBeVisible({ timeout: 15000 });
  });

  test("20.4 手机端风险分析区块条形图降级 (canvas 渲染)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "移动端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${contractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("风险分析")).toBeVisible({ timeout: 30000 });
    // 图表为动态加载, 等 canvas 挂载 (手机端走 Column 条形图而非雷达)
    const chartCard = page.locator(".ant-pro-card", { hasText: "风险分析" });
    await expect(chartCard.locator("canvas").first()).toBeVisible({ timeout: 20000 });
  });

  test("20.5 非手机断点不渲染底部导航", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile) && (page.viewportSize()?.width ?? 999) < 600, "仅平板/桌面");
    await loginAsSales(page);
    await page.goto("/contracts/workbench");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("我的活跃合同")).toBeVisible({ timeout: 30000 });
    // 桌面/平板由侧边栏承担导航, 底部固定导航不渲染
    const navLinks = page.locator("nav").last().getByRole("link", { name: "我的" });
    expect(await navLinks.count()).toBe(0);
  });
});
