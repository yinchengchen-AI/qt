// 场景 19：规则引擎风险报告 E2E (Phase 4a)
//
// 覆盖:
//   1) 详情页概览 tab 渲染「风险分析」区块 (评分 + 等级 + 加权公式)
//   2) 五维度雷达/明细渲染 (维度标签可见)
//   3) 新合同无快照 → 趋势区显示「数据积累中」(spec §12)
//   4) 建议操作列表渲染
//
// 数据: prisma 直造 fixture (ACTIVE 合同), TAG 前缀自清理.
// 登录态走 _auth.ts 进程内共享; 桌面交互用例在移动端 project 跳过.
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { loginCookiesOnce } from "./_auth";

const TAG = `E2E-RR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const DAY_MS = 86_400_000;
let salesId = "";
let customerId = "";
let contractId = "";

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
      contactPhone: "13800000444",
      ownerUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  customerId = cust.id;
  const now = Date.now();
  const c = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-C`,
      customerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-风险合同`,
      serviceType: "OTHER",
      signDate: new Date(now - 100 * DAY_MS),
      startDate: new Date(now - 100 * DAY_MS),
      endDate: new Date(now + 265 * DAY_MS),
      totalAmount: 80000,
      taxRate: 0.06,
      taxAmount: Number((80000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((80000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesId,
      signerId: salesId,
      attachments: [],
      createdById: salesId,
      updatedById: salesId
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

test.describe.serial("场景 19: 风险报告 E2E", () => {
  test("19.1 详情页「风险分析」区块渲染 (评分 + 公式)", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${contractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("风险分析")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/风险评分 \d+/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/加权公式：.+×0\.30.+/)).toBeVisible();
  });

  test("19.2 五维度明细渲染", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${contractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("风险分析")).toBeVisible({ timeout: 30000 });
    for (const label of ["到期风险", "付款进度", "开票进度", "客户信用", "金额异常"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("19.3 新合同无快照 → 趋势「数据积累中」", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${contractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("风险分析")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("数据积累中")).toBeVisible({ timeout: 15000 });
    // 建议操作区渲染
    await expect(page.getByText("建议操作")).toBeVisible();
  });

  test("19.4 AI 分析区: 按钮触发生成, 结果或降级错误都正常呈现", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "桌面端用例");
    await loginAsSales(page);
    await page.goto(`/contracts/${contractId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "AI 分析" })).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "生成 AI 分析" }).click();
    // 有 key+网络 → 摘要 Alert(info); 无 key/限流 → 降级 Alert(warning); 两者必居其一, 页面不白屏
    const summary = page.locator(".ant-alert-info");
    const degraded = page.locator(".ant-alert-warning");
    await expect(summary.or(degraded).first()).toBeVisible({ timeout: 60000 });
  });
});
