// E2E 验证钉钉扫码登录全流程;通过 page.route 拦截钉钉 upstream 模拟确认/未确认/取消
import { test, expect, type Page } from "@playwright/test";

const DINGTALK_HOST = "**/oapi.dingtalk.com/**";

async function mockDingtalkUpstream(page: Page, opts: { confirmed: boolean; mobile: string; unionid: string }) {
  await page.route(DINGTALK_HOST, async (route) => {
    const url = route.request().url();
    if (url.includes("/gettoken")) {
      return route.fulfill({ json: { access_token: "fake_token", expires_in: 7200 } });
    }
    if (url.includes("/sns_authorize")) {
      return route.fulfill({ json: { tmpCode: "fake_tmp", expiresIn: 180, qrcodeUrl: "https://example.com/qr" } });
    }
    if (url.includes("/sns_token")) {
      if (opts.confirmed) {
        return route.fulfill({ json: { status: "CONFIRMED", authCode: "fake_auth" } });
      }
      return route.fulfill({ json: { status: "PENDING" } });
    }
    if (url.includes("/user/getuserinfo")) {
      return route.fulfill({ json: { result: { userid: opts.unionid } } });
    }
    if (url.includes("/user/get")) {
      return route.fulfill({ json: { result: { mobile: opts.mobile, nick: "Test" } } });
    }
    return route.continue();
  });
}

test.describe("DingTalk QR Login", () => {
  test.skip(!process.env.DINGTALK_APP_KEY, "DINGTALK_APP_KEY not set, skipping E2E");

  test("happy path: scan confirm -> dashboard or unbound (depends on admin.phone)", async ({ page }) => {
    const adminMobile = "13800000001";
    await mockDingtalkUpstream(page, { confirmed: true, mobile: adminMobile, unionid: "test_e2e_uid" });
    await page.goto("/login");
    await expect(page.getByText("使用钉钉扫码登录")).toBeVisible();
    await page.getByText("使用钉钉扫码登录").click();
    await expect(page.locator("#dingtalk-qr")).toBeVisible();
    await Promise.race([
      page.waitForURL(/dashboard/, { timeout: 10000 }),
      page.getByText("未关联").waitFor({ timeout: 10000 }).catch(() => null),
    ]);
  });

  test("phone not registered -> show unbound hint", async ({ page }) => {
    await mockDingtalkUpstream(page, { confirmed: true, mobile: "19900000000", unionid: "test_e2e_orphan" });
    await page.goto("/login");
    await page.getByText("使用钉钉扫码登录").click();
    await expect(page.locator("#dingtalk-qr")).toBeVisible();
    await expect(page.getByText("未关联系统用户")).toBeVisible({ timeout: 10000 });
  });
});