import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("isDingtalkEnabled", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.DINGTALK_APP_KEY;
    delete process.env.DINGTALK_APP_SECRET;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("APP_KEY/SECRET 都缺 → false", async () => {
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(false);
  });

  it("仅 APP_KEY 缺 SECRET → false", async () => {
    process.env.DINGTALK_APP_KEY = "key123";
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(false);
  });

  it("两者都有 → true", async () => {
    process.env.DINGTALK_APP_KEY = "key123";
    process.env.DINGTALK_APP_SECRET = "secret456";
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(true);
  });
});
