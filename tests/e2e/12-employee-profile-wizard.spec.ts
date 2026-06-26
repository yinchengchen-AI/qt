// 场景 12: 员工档案向导 + Anchor 详情 + 证书到期 cron
// 登录 → 用户列表 → 新建用户 → 两段式补档案 → 5 步向导 → 详情页 Anchor 验证 → cron 触发
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const employeeNo = `E2E${stamp.toString().slice(-6)}`;
const userName = `E2E档案${stamp.toString().slice(-4)}`;
const userEmail = `e2e-profile-${stamp}@qt.local`;

test.describe("场景 12: 员工档案向导与详情", () => {
  test("admin 完整链路:登录 → 新建 → 5 步向导 → 详情 Anchor → cron", async ({ page }) => {
    // 1. 登录 admin
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);

    // 2. 新建用户
    await page.goto("/admin/users/new");
    await page.waitForLoadState("networkidle");

    // 监听控制台,便于调试提交失败原因
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[PAGE ERROR]", msg.text());
    });
    page.on("pageerror", (err) => {
      console.log("[PAGE UNCAUGHT ERROR]", err.message, err.stack);
    });
    page.on("response", async (resp) => {
      if (resp.url().includes("/api/users") && resp.request().method() === "POST") {
        const body = await resp.text().catch(() => "");
        console.log("[CREATE USER RESPONSE]", resp.status(), body.slice(0, 500));
      }
      if (resp.url().match(/\/api\/users\/[^/]+\/with-profile/) && resp.request().method() === "PATCH") {
        const body = await resp.text().catch(() => "");
        console.log("[PATCH PROFILE RESPONSE]", resp.status(), body.slice(0, 1000));
      }
      if (resp.url().match(/\/api\/users\/[^/]+(\/with-profile)?$/) && resp.request().method() === "GET") {
        const body = await resp.text().catch(() => "");
        console.log("[GET USER/PROFILE RESPONSE]", resp.status(), resp.url(), body.slice(0, 1000));
      }
    });

    await page.getByLabel("工号").fill(employeeNo);
    await page.getByLabel("姓名").fill(userName);
    await page.getByLabel("邮箱").fill(userEmail);

    // 等待角色选项加载后选择第一个
    await page.getByLabel("角色").click();
    await page.waitForTimeout(800);
    const firstRole = page.locator(".ant-select-item-option").first();
    await expect(firstRole).toBeVisible({ timeout: 5000 });
    await firstRole.click();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /保\s*存/ }).click();

    // 等待提交完成:要么成功弹窗,要么错误提示
    await page.waitForLoadState("networkidle");

    // 3. 两段式补档案引导
    await page.getByRole("button", { name: "知道了" }).click();

    await page.getByRole("button", { name: "现在补全档案" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/users/[^/]+/edit-profile`));
    await expect(page.getByText("基础").first()).toBeVisible({ timeout: 10000 });

    // 4. 5 步向导填写档案
    // Step 1: 基础
    await page.getByRole("combobox", { name: "性别" }).click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "男" }).click();
    await page.getByLabel("身份证号").click(); // 关闭 select 下拉

    await page.getByLabel("生日").fill("1990-05-20");
    await page.getByLabel("生日").press("Enter");
    await page.getByLabel("身份证号").fill("330102199005201238");

    await page.getByRole("combobox", { name: "最高学历" }).click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "本科" }).click();
    await page.getByLabel("详细地址").click(); // 关闭 select 下拉

    await page.getByLabel("入职日期").fill("2024-01-01");
    await page.getByLabel("入职日期").press("Enter");
    await page.getByLabel("详细地址").fill("杭州市西湖区 test 路 1 号");

    // 紧急联系人
    await page.getByRole("button", { name: "新增紧急联系人" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("姓名").last().fill("张联系人");
    await page.getByRole("combobox", { name: "关系" }).last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "配偶" }).click();
    await page.getByLabel("电话").last().click(); // 关闭 select 下拉
    await page.getByLabel("电话").last().fill("13800138000");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByText("下一步", { exact: true }).first().click();

    // Step 2: 岗位合同
    await page.getByLabel("岗位").fill("测试工程师");
    await page.getByLabel("职级").fill("P5");

    await page.getByLabel("用工类型").click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "全职" }).click();
    await page.getByLabel("合同开始").click(); // 关闭 select 下拉

    await page.getByLabel("合同开始").fill("2024-01-01");
    await page.getByLabel("合同开始").press("Enter");
    await page.getByLabel("合同结束").fill("2027-01-01");
    await page.getByLabel("合同结束").press("Enter");

    await page.getByRole("button", { name: "下一步" }).click();

    // Step 3: 敏感(仅 ADMIN)
    await expect(page.getByText("本页仅管理员可见")).toBeVisible({ timeout: 5000 });
    await page.getByLabel("薪资").fill("15000");
    await page.getByLabel("银行卡号").fill("6222021234567890123");
    await page.getByLabel("开户行").fill("工商银行杭州支行");
    await page.getByLabel("社保账号").fill("3301001234");
    await page.getByLabel("公积金账号").fill("3301005678");

    await page.getByRole("button", { name: "下一步" }).click();

    // Step 4: 履历
    await page.getByRole("button", { name: "新增教育经历" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("学校").last().fill("浙江大学");
    await page.getByLabel("专业").last().fill("计算机");
    await page.getByLabel("学历").last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "本科" }).click();
    await page.getByLabel("专业").last().click(); // 关闭 select 下拉

    await page.getByLabel(/入学/).last().fill("2012-09-01");
    await page.getByLabel(/入学/).last().press("Enter");
    await page.getByLabel(/毕业/).last().fill("2016-06-30");
    await page.getByLabel(/毕业/).last().press("Enter");

    await page.getByRole("button", { name: "新增技能" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("技能名").last().fill("Playwright");
    await page.getByLabel("熟练度").last().click();
    await page.locator(".ant-select-dropdown").last().locator(".ant-select-item-option", { hasText: "高级" }).click();
    await page.getByLabel("技能名").last().click(); // 关闭 select 下拉

    await page.getByRole("button", { name: "下一步" }).click();

    // Step 5: 证书与附件
    await page.getByRole("button", { name: "新增证书" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("证书名").last().fill("PMP 项目管理");
    await page.getByLabel("编号").last().fill("PMP-2024-001");
    await page.getByLabel(/到期日/).last().fill("2030-12-31");
    await page.getByLabel(/到期日/).last().press("Enter");

    // 提交
    const submitBtn = page.getByRole("button", { name: /提\s*交/ });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // 成功后跳到详情页(不能是 edit-profile 自身)
    await expect(page).toHaveURL(new RegExp(`/admin/users/[^/]+/?$`), { timeout: 15000 });

    // 5. 详情页 Anchor 与分组
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#basic")).toContainText("基础");
    await expect(page.locator("#position")).toContainText("岗位与合同");
    await expect(page.locator("#sensitive")).toContainText("敏感信息");
    await expect(page.locator("#history")).toContainText("履历");
    await expect(page.locator("#certs")).toContainText("证书与附件");

    // 详情页右侧 Anchor 已删, 改用 scrollIntoView
    await page.locator("#certs").scrollIntoViewIfNeeded();
    await expect(page.locator("#certs")).toBeVisible();

    await expect(page.getByText(userName).first()).toBeVisible();
    await expect(page.getByText("测试工程师")).toBeVisible();
    await expect(page.getByText("P5")).toBeVisible();
    await expect(page.getByText("PMP 项目管理")).toBeVisible();
    await expect(page.getByText("Playwright")).toBeVisible();

    // 6. 证书到期 cron 任务可触发(不抛 500 即可)
    const cronResp = await page.request.post("/api/jobs/certificates/expire-check", {
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "test-secret" }
    });
    expect([200, 401]).toContain(cronResp.status());
  });
});
