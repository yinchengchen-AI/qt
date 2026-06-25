// 场景 13: 员工列表批量操作 + 导出
// 登录 → 用户列表 → 多选 → 批量禁用/启用/调整部门 → 导出 CSV
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

test.describe("场景 13: 员工列表批量操作与导出", () => {
  test("admin 批量操作链路", async ({ page }) => {
    // 1. 登录 admin
    await page.goto("/login");
    await page.getByPlaceholder("请输入工号").fill("admin");
    await page.getByPlaceholder("请输入密码").fill(DEV_PASSWORD);
    await page.getByText("登 录", { exact: true }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });

    // 2. 进入员工列表
    await page.goto("/admin/users");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("columnheader", { name: "工号" })).toBeVisible({ timeout: 10000 });

    // 3. 选中多个非 admin 账号(sales / finance)
    const rows = page.locator(".ant-pro-table tbody tr");
    await expect(rows.first()).toBeVisible();

    // 找到 sales 和 finance 的 checkbox 并选中
    // 用文本内容匹配行,然后点击该行的 checkbox
    const salesRow = rows.filter({ hasText: /sales/i });
    const financeRow = rows.filter({ hasText: /finance/i });

    if (await salesRow.count() > 0) {
      await salesRow.locator(".ant-checkbox-input").first().click();
    }
    if (await financeRow.count() > 0) {
      await financeRow.locator(".ant-checkbox-input").first().click();
    }

    // 4. 验证批量操作栏出现
    await expect(page.getByText(/已选 \d+ 人/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "批量禁用" })).toBeVisible();
    await expect(page.getByRole("button", { name: "批量启用" })).toBeVisible();
    await expect(page.getByRole("button", { name: "批量调整部门" })).toBeVisible();
    await expect(page.getByRole("button", { name: "批量删除" })).toBeVisible();

    // 5. 批量禁用(如果选中了)
    const selectedTag = page.locator("text=/已选 \\d+ 人/");
    if (await selectedTag.count() > 0) {
      const selectedText = await selectedTag.textContent();
      const match = selectedText?.match(/已选 (\d+) 人/);
      const selectedCount = match && match[1] ? parseInt(match[1], 10) : 0;

      if (selectedCount > 0) {
        // 批量禁用
        await page.getByRole("button", { name: "批量禁用" }).click();
        // 确认弹窗(Modal.confirm 在 Playwright 中表现为 .ant-modal-confirm)
        await page.locator(".ant-modal-confirm").getByRole("button", { name: "确定" }).click();
        await page.waitForLoadState("networkidle");

        // 验证成功提示
        await expect(page.getByText(/禁用 \d+ 个账号/)).toBeVisible({ timeout: 10000 });

        // 6. 重新选中并批量启用
        if (await salesRow.count() > 0) {
          await salesRow.locator(".ant-checkbox-input").first().click();
        }
        if (await financeRow.count() > 0) {
          await financeRow.locator(".ant-checkbox-input").first().click();
        }
        await page.getByRole("button", { name: "批量启用" }).click();
        await page.locator(".ant-modal-confirm").getByRole("button", { name: "确定" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText(/启用 \d+ 个账号/)).toBeVisible({ timeout: 10000 });

        // 7. 批量调整部门
        if (await salesRow.count() > 0) {
          await salesRow.locator(".ant-checkbox-input").first().click();
        }
        if (await financeRow.count() > 0) {
          await financeRow.locator(".ant-checkbox-input").first().click();
        }
        await page.getByRole("button", { name: "批量调整部门" }).click();
        // 打开 Modal,选择第一个部门
        await page.getByRole("combobox", { name: "" }).click();
        await page.waitForTimeout(500);
        const firstDept = page.locator(".ant-select-tree-list").locator(".ant-select-tree-node-content-wrapper").first();
        if (await firstDept.count() > 0) {
          await firstDept.click();
        }
        await page.getByRole("button", { name: "确认调整" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText(/已调整 \d+ 个账号的部门/)).toBeVisible({ timeout: 10000 });
      }
    }

    // 8. 验证导出按钮存在
    await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
  });
});
