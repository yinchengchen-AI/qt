import { describe, it, expect } from "vitest";
import { getDevQuickFillPassword } from "@/lib/dev-quick-fill";

describe("getDevQuickFillPassword", () => {
  it("非生产环境返回 DEV_QUICK_FILL_PASSWORD", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPwd = process.env.DEV_QUICK_FILL_PASSWORD;

    Object.assign(process.env, { NODE_ENV: "development", DEV_QUICK_FILL_PASSWORD: "test-pass-123" });
    expect(getDevQuickFillPassword()).toBe("test-pass-123");

    delete process.env.DEV_QUICK_FILL_PASSWORD;
    expect(getDevQuickFillPassword()).toBe("dev-only-fill");

    Object.assign(process.env, { NODE_ENV: originalNodeEnv, DEV_QUICK_FILL_PASSWORD: originalPwd });
  });

  it("生产环境返回空串", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production", DEV_QUICK_FILL_PASSWORD: "should-not-return" });

    expect(getDevQuickFillPassword()).toBe("");

    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  });
});