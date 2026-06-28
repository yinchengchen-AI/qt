import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 20000
  },
  webServer: {
    command: "npm run dev > /tmp/dev.log 2>&1",
    url: "http://localhost:3000/api/auth/csrf",
    reuseExistingServer: true,
    timeout: 60000
  },
  // 三套视口:桌面回归 + iPad 竖屏 + iPhone 13
  // 桌面已有 chromium + chrome channel,新增 mobile 项目用 webkit/firefox 等设备默认引擎
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", launchOptions: { channel: "chrome" } }
    },
    {
      name: "ipad-portrait",
      use: {
        ...devices["iPad (gen 7) landscape"],
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2
      }
    },
    {
      name: "iphone-13",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3
      }
    }
  ]
});
