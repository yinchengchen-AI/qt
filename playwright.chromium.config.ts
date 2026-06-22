import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    actionTimeout: 30000,
    navigationTimeout: 30000
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: { channel: "chrome" } } }
  ]
});
