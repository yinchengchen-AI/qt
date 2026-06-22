import { describe, it, expect } from "vitest";
import { gone410 } from "@/lib/dead-route";

describe("gone410 helper", () => {
  it("返回 410 状态码", async () => {
    const res = gone410("recurring");
    expect(res.status).toBe(410);
  });

  it("响应体 code=41001", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.code).toBe(41001);
  });

  it("响应体 message 含端点名", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.message).toContain("recurring");
  });

  it("响应体 message 含设计文档路径", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.message).toContain(
      "docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md",
    );
  });
});
