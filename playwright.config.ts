import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: {
      channel: "chrome"
    },
    actionTimeout: 15000,
    navigationTimeout: 20000
  },
  webServer: {
    command: "npm run dev > /tmp/dev.log 2>&1",
    url: "http://localhost:3000/api/auth/csrf",
    reuseExistingServer: true,
    timeout: 60000
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", launchOptions: { channel: "chrome" } }
    }
  ]
});
