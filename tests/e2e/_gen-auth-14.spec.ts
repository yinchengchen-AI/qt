// 一次性脚本: 登录 admin 存 storageState, 供 14-* test 复用
// 用法: npx playwright test _gen-auth-14 --project=chromium
import { test } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";
import * as fs from "node:fs";

const STORAGE_STATE_PATH = "tests/e2e/.auth/14-admin.json";

test("生成 admin storage state", async ({ browser }) => {
  fs.mkdirSync("tests/e2e/.auth", { recursive: true });
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    console.log("已存在, 跳过");
    return;
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("工号", { exact: true }).fill("admin");
  await page.getByPlaceholder("密码", { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "登 录", exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await ctx.storageState({ path: STORAGE_STATE_PATH });
  await ctx.close();
  console.log("已写入", STORAGE_STATE_PATH);
});
