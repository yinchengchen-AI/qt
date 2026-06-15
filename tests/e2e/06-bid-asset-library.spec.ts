// 标书素材库 v1 — 录入人员证书 / 投标模板 / 列表筛选 / 现有 8 类补齐上传 + 权限回归
// 覆盖 spec §5 / §8.3 / §10 关键路径
// 跑法: npm run dev:setup 起来后,npm run test:e2e -- 06-bid-asset-library
import { test, expect, type Page } from "@playwright/test";

const stamp = Date.now();
const certName = `E2E人员证书-${stamp}`;
const templateName = `E2E投标模板-${stamp}`;
const licenseName = `E2E营业执照-${stamp}`;

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

test.describe.serial("06 - 标书素材库 v1", () => {
  test("06.1 admin 登录并进入 /assets 主页", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "企业资产" })).toBeVisible({ timeout: 10000 });
    // 标书素材库定位文案
    await expect(page.getByText(/标书素材库/)).toBeVisible();
    // admin 看到"录入资产"按钮
    await expect(page.getByRole("button", { name: "录入资产" })).toBeVisible();
  });

  test("06.2 场景 A: 录入人员证书 (PERSONNEL_CERT) - 端到端", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets/new");
    await page.waitForLoadState("networkidle");

    // Step 1: 选类型 - 点人员证书卡片
    await page.getByText("人员证书", { exact: true }).first().click();

    // Step 2: 资产名称 + 标签
    await page.getByLabel("资产名称").fill(certName);
    await page.getByLabel("标签").fill("e2e,test");

    // Step 3: 人员证书专属字段
    await page.getByLabel("证书类型").click();
    await page.getByText(/注册安全工程师/).first().click();
    await page.getByLabel("证书编号").fill(`RSE-${stamp}`);
    await page.getByLabel("颁发机构").fill("国家应急管理部");
    await page.getByLabel("持证人").fill("张三");
    // 有效期:今天 + 1 年
    const future = new Date(Date.now() + 365 * 86_400_000);
    const iso = future.toISOString().slice(0, 10);
    await page.getByLabel("到期日期").fill(iso);

    // Step 4: 提交
    await page.getByRole("button", { name: /保存|提 交|确 认/ }).first().click();

    // Step 5: 跳到详情页
    await page.waitForURL(/\/assets\/[a-z0-9-]+$/, { timeout: 15000 });
    await expect(page.getByText("人员证书").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`RSE-${stamp}`)).toBeVisible();
    await expect(page.getByText("国家应急管理部")).toBeVisible();
    await expect(page.getByText("张三")).toBeVisible();
  });

  test("06.3 列表筛选 PERSONNEL_CERT 能看到刚录入", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets/list");
    await page.waitForLoadState("networkidle");

    // 类型 Select: 点开 → 选人员证书
    await page.getByPlaceholder("类型(全部)").click();
    await page.getByText("人员证书", { exact: true }).first().click();

    // 列表应渲染并能看到我们录入的资产
    await expect(page.locator(".ant-pro-table").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(certName).first()).toBeVisible({ timeout: 10000 });
  });

  test("06.4 场景 B: 录入投标模板 (TEMPLATE) - 通用模板 (留空服务类型)", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets/new");
    await page.waitForLoadState("networkidle");

    // 选投标模板
    await page.getByText("投标模板", { exact: true }).first().click();

    await page.getByLabel("资产名称").fill(templateName);
    // 服务类型(可选)留空
    await page.getByLabel("标签").fill("通用,投标函");

    // 提交
    await page.getByRole("button", { name: /保存|提 交|确 认/ }).first().click();

    // 跳详情
    await page.waitForURL(/\/assets\/[a-z0-9-]+$/, { timeout: 15000 });
    await expect(page.getByText("投标模板").first()).toBeVisible({ timeout: 10000 });
  });

  test("06.5 场景 C: 现有 8 类补齐 - 录入 LICENSE 营业执照 (无文件)", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets/new");
    await page.waitForLoadState("networkidle");

    // 选营业执照
    await page.getByText("营业执照", { exact: true }).first().click();

    await page.getByLabel("资产名称").fill(licenseName);

    // 提交(无附件,v1 允许现有 8 类无附件)
    await page.getByRole("button", { name: /保存|提 交|确 认/ }).first().click();

    // 详情页能打开就视为通过
    await page.waitForURL(/\/assets\/[a-z0-9-]+$/, { timeout: 15000 });
    await expect(page.getByText("营业执照").first()).toBeVisible({ timeout: 10000 });
  });

  test("06.6 场景 D: 列表类型下拉里能看到 v1 新增的 2 类", async ({ page }) => {
    await ensureLoggedIn(page, "admin", "123456");
    await page.goto("/assets/list");
    await page.waitForLoadState("networkidle");

    // 类型下拉里应能看到 v1 新增的 2 个标签
    await page.getByPlaceholder("类型(全部)").click();
    await expect(page.getByText("人员证书", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("投标模板", { exact: true }).first()).toBeVisible();
    // 已有 8 类(选 1 个验证)
    await expect(page.getByText("营业执照", { exact: true }).first()).toBeVisible();
  });

  test("06.7 权限: SALES 看不到 /assets 的 '录入资产' 按钮 (回归)", async ({ page }) => {
    await ensureLoggedIn(page, "sales", "123456");
    await page.goto("/assets");
    await page.waitForLoadState("networkidle");

    // SALES 看不到"录入资产"和"批量导入"(admin-only 按钮)
    await expect(page.getByRole("button", { name: "录入资产" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "批量导入" })).toHaveCount(0);
    // 仍然能看到"资产列表"和"导出 Excel"按钮(全员可见)
    await expect(page.getByRole("button", { name: "资产列表" })).toBeVisible();
  });

  test("06.8 权限: SALES 直接 POST /api/assets 应被服务端拒绝", async ({ page }) => {
    await ensureLoggedIn(page, "sales", "123456");
    // 直接打 POST 模拟绕过 UI - 服务端应 403
    const res = await page.request.post("/api/assets", {
      data: {
        type: "PERSONNEL_CERT",
        name: "SALES-尝试-录入",
        attributes: { certificateType: "OTHER", certificateNo: "X", issuingAuthority: "Y", holder: "Z" }
      }
    });
    // 期望非 2xx
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
