import { defineConfig } from "vitest/config";
import path from "node:path";

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
