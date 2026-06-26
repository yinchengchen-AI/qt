// 场景 14: 员工档案 CRUD + 附件上传 E2E
// 覆盖:
//   - admin 通过 API 创建用户 → 5 步向导填写 + 头像/证书附件上传 → 创建 profile
//   - 详情页 5 分组 + Anchor + 数据展示
//   - 编辑向导更新字段 + 新增证书 → 验证更新
//   - API 软删用户 → 列表不可见
//
// 用 dev 数据库; 测试数据用 stamp 后缀避免污染.
// 用 storage state 共享 admin 登录态避免多次登录触发 NextAuth 限流.
import { test, expect, type Page } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const employeeNo = `E2E14${stamp.toString().slice(-6)}`;
const userName = `E2E14档案${stamp.toString().slice(-4)}`;
const userEmail = `e2e14-${stamp}@qt.local`;

const UPDATED_POSITION = `E2E14高级测试工程师-${stamp}`;

// 1x1 透明 PNG, 用于头像 + 证书附件上传
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// 共享 admin 登录态: beforeAll 登录一次存 storageState, 后续 test 复用
const STORAGE_STATE_PATH = "tests/e2e/.auth/14-admin.json";

test.beforeAll(async ({ browser }) => {
  const fs = await import("node:fs");
  fs.mkdirSync("tests/e2e/.auth", { recursive: true });
  if (fs.existsSync(STORAGE_STATE_PATH)) return; // 已登录过, 跳过
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("请输入工号").fill("admin");
  await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await ctx.storageState({ path: STORAGE_STATE_PATH });
  await ctx.close();
});

test.use({ storageState: STORAGE_STATE_PATH });

test.describe.serial("14 - 员工档案 CRUD + 附件上传", () => {
  let testUserId = "";

  // ---------- 14.0 setup: API 创建用户 ----------
  test("14.0 admin 通过 API 创建测试用户 (无 profile)", async ({ request }) => {
    // shared storage 已经有 admin cookie
    const rolesJson = await (await request.get("/api/roles?pageSize=100")).json();
    const salesRole = rolesJson?.data?.list?.find(
      (r: { code: string }) => r.code === "SALES"
    );
    expect(salesRole, "应能找到种子角色").toBeTruthy();

    const createRes = await request.post("/api/users", {
      headers: { "content-type": "application/json" },
      data: {
        employeeNo,
        name: userName,
        email: userEmail,
        roleId: salesRole.id,
        status: "ACTIVE"
      }
    });
    const createJson = await createRes.json();
    expect(createJson.code, `POST /api/users: ${JSON.stringify(createJson)}`).toBe(0);
    testUserId = createJson.data.id;
    expect(testUserId).toBeTruthy();
  });

  // ---------- 14.1 create: 向导 + 附件上传 ----------
  test("14.1 admin 通过 5 步向导创建 profile, 上传头像 + 证书附件", async ({ page }) => {
    page.on("response", async (resp) => {
      if (resp.url().match(/\/api\/users\/[^/]+\/with-profile/) && resp.request().method() === "PATCH") {
        const body = await resp.text().catch(() => "");
        console.log("[PATCH PROFILE]", resp.status(), body.slice(0, 300));
      }
    });

    await page.goto(`/admin/users/${testUserId}/edit-profile`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("基础").first()).toBeVisible({ timeout: 15000 });

    // 头像上传 (第一个 file input)
    const avatarInput = page.locator(".ant-upload input[type='file']").first();
    await avatarInput.setInputFiles({
      name: `e2e14-avatar-${stamp}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BASE64, "base64")
    });

    // Step 1: 基础
    await page.getByLabel("性别").first().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "男" }).click();
    await page.getByLabel("身份证号").click();
    await page.getByLabel("生日").fill("1991-03-15");
    await page.getByLabel("生日").press("Enter");
    // idCard optional, 不填避免 checksum 严格校验

    await page.getByLabel("最高学历").click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "本科" }).click();
    await page.getByLabel("详细地址").click();

    await page.getByLabel("入职日期").fill("2024-02-01");
    await page.getByLabel("入职日期").press("Enter");
    await page.getByLabel("详细地址").fill("杭州市余杭区 E2E14 路 1 号");

    // 紧急联系人
    await page.getByRole("button", { name: "新增紧急联系人" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("姓名").last().fill("E2E14 联系人");
    await page.getByLabel("关系").last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "配偶" }).click();
    await page.getByLabel("电话").last().click();
    await page.getByLabel("电话").last().fill("13900001111");

    await page.getByRole("button", { name: "下一步" }).first().click();

    // Step 2: 岗位合同
    await page.getByLabel("岗位").fill("E2E14 测试工程师");
    await page.getByLabel("职级").fill("P4");
    await page.getByLabel("用工类型").click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "全职" }).click();
    await page.getByLabel("合同开始").click();
    await page.getByLabel("合同开始").fill("2024-02-01");
    await page.getByLabel("合同开始").press("Enter");
    await page.getByLabel("合同结束").fill("2027-02-01");
    await page.getByLabel("合同结束").press("Enter");
    await page.getByRole("button", { name: "下一步" }).click();

    // Step 3: 敏感
    await expect(page.getByText("本页仅管理员可见").first()).toBeVisible({ timeout: 5000 });
    await page.getByLabel("薪资").fill("15000");
    await page.getByLabel("银行卡号").fill("6222021234567890123");
    await page.getByLabel("开户行").fill("工商银行 E2E14 支行");
    await page.getByRole("button", { name: "下一步" }).click();

    // Step 4: 履历
    await page.getByRole("button", { name: "新增教育经历" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("学校").last().fill("E2E14 大学");
    await page.getByLabel("专业").last().fill("软件工程");
    await page.getByLabel("学历").last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "本科" }).click();
    await page.getByLabel("专业").last().click();
    await page.getByLabel(/入学/).last().fill("2013-09-01");
    await page.getByLabel(/入学/).last().press("Enter");
    await page.getByLabel(/毕业/).last().fill("2017-06-30");
    await page.getByLabel(/毕业/).last().press("Enter");

    await page.getByRole("button", { name: "新增技能" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("技能名").last().fill("Playwright");
    await page.getByLabel("熟练度").last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "高级" }).click();
    await page.getByLabel("技能名").last().click();

    await page.getByRole("button", { name: "下一步" }).click();

    // Step 5: 证书 + 附件
    await page.getByRole("button", { name: "新增证书" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("证书名").last().fill("E2E14 软考高级证书");
    await page.getByLabel("编号").last().fill(`E2E14-${stamp}`);
    await page.getByLabel(/到期日/).last().fill("2030-12-31");
    await page.getByLabel(/到期日/).last().press("Enter");

    // 证书附件 (第二个 file input, 第一个是头像)
    const certAttachmentInput = page.locator(".ant-upload input[type='file']").nth(1);
    await certAttachmentInput.setInputFiles({
      name: `e2e14-cert-${stamp}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BASE64, "base64")
    });

    const submitBtn = page.getByRole("button", { name: /提\s*交/ });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    await expect(page).toHaveURL(new RegExp(`/admin/users/${testUserId}/?$`), { timeout: 20000 });
    await page.waitForLoadState("networkidle");
  });

  // ---------- 14.2 read: 详情页 5 分组 ----------
  test("14.2 详情页渲染 5 个分组 + 证书数据", async ({ page }) => {
    await page.goto(`/admin/users/${testUserId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#basic")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#position")).toBeVisible();
    await expect(page.locator("#sensitive")).toBeVisible();
    await expect(page.locator("#history")).toBeVisible();
    await expect(page.locator("#certs")).toBeVisible();

    await expect(page.getByText("E2E14 联系人").first()).toBeVisible();
    await expect(page.getByText("E2E14 测试工程师")).toBeVisible();
    await expect(page.getByText("P4")).toBeVisible();
    await expect(page.getByText("E2E14 软考高级证书")).toBeVisible();
    await expect(page.getByText("Playwright").first()).toBeVisible();

    // 滚到 #certs 验证锚点 (Anchor 已删, 改用 scrollIntoView)
    await page.locator("#certs").scrollIntoViewIfNeeded();
    await expect(page.locator("#certs")).toBeVisible();
  });

  // ---------- 14.3 update: 编辑向导 ----------
  test("14.3 admin 走向导更新 profile (改岗位 / 薪资 / 新增证书)", async ({ page }) => {
    await page.goto(`/admin/users/${testUserId}/edit-profile`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("基础").first()).toBeVisible({ timeout: 15000 });

    // 跳过基础, 改 Step 2 岗位
    await page.getByRole("button", { name: "下一步" }).first().click();
    await page.waitForTimeout(500);
    await page.getByLabel("岗位").fill(UPDATED_POSITION);
    await page.getByLabel("职级").fill("P6");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    // Step 3 改薪资
    await expect(page.getByText("本页仅管理员可见").first()).toBeVisible({ timeout: 5000 });
    await page.getByLabel("薪资").fill("22500");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    // Step 4 跳过
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    // Step 5 新增一个证书
    await page.getByRole("button", { name: "新增证书" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("证书名").last().fill("E2E14 更新后证书");
    await page.getByLabel("编号").last().fill(`E2E14UPD-${stamp}`);
    await page.getByLabel(/到期日/).last().fill("2031-06-30");
    await page.getByLabel(/到期日/).last().press("Enter");

    const submitBtn = page.getByRole("button", { name: /提\s*交/ });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();
    await expect(page).toHaveURL(new RegExp(`/admin/users/${testUserId}/?$`), { timeout: 20000 });
    await page.waitForLoadState("networkidle");
  });

  // ---------- 14.4 验证更新 ----------
  test("14.4 详情页验证更新 (新岗位 / 新薪资 / 新证书)", async ({ page }) => {
    await page.goto(`/admin/users/${testUserId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#position")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#sensitive")).toBeVisible();
    await expect(page.locator("#certs")).toBeVisible();

    await expect(page.getByText(UPDATED_POSITION)).toBeVisible({ timeout: 5000 });
    // formatCurrency: ¥22,500.00
    await expect(page.getByText(/22,500/)).toBeVisible();
    await expect(page.getByText("E2E14 更新后证书")).toBeVisible();
  });

  // ---------- 14.5 delete: API 软删 ----------
  test("14.5 admin 通过 API 软删用户", async ({ request }) => {
    // shared storage 已有 admin cookie, request 自动带上
    const res = await request.delete(`/api/users/${testUserId}`);
    const body = await res.text();
    expect(body, `status=${res.status()}`).toBeTruthy();
    const json = JSON.parse(body);
    expect(json.code, `DELETE /api/users body: ${body.slice(0, 500)}`).toBe(0);
  });

  // ---------- 14.6 验证删除 ----------
  test("14.6 用户列表看不到已删除用户", async ({ page }) => {
    await page.goto("/admin/users");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByPlaceholder(/搜索/);
    if (await searchInput.count() > 0) {
      await searchInput.first().fill(employeeNo);
      await page.waitForTimeout(800);
    }
    await expect(page.getByText(employeeNo)).toHaveCount(0);
  });
});
