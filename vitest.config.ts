import { defineConfig } from "vitest/config";
import path from "node:path";
import dotenv from "dotenv";

// 加载 .env,确保 env 校验通过(DATABASE_URL/NEXTAUTH_SECRET/APP_ENC_KEY_HEX 等)
dotenv.config({ path: ".env" });

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "tests/e2e/**"]
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") }
  }
});
