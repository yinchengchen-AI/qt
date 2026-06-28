import { describe, it, expect } from "vitest";
import { attachmentUrlSchema } from "@/lib/validators/_shared";

describe("attachmentUrlSchema", () => {
  it("接受以 / 开头的相对路径 (legacy 假链接, /upload/xxx.pdf)", () => {
    const r = attachmentUrlSchema.safeParse("/upload/legacy-file.pdf");
    expect(r.success, r.success ? "" : (r.error?.issues[0]?.message ?? "")).toBe(true);
  });

  it("接受 https 绝对 URL", () => {
    const r = attachmentUrlSchema.safeParse("https://example.com/file.pdf");
    expect(r.success).toBe(true);
  });

  it("接受 http 绝对 URL", () => {
    const r = attachmentUrlSchema.safeParse("http://example.com/file.pdf");
    expect(r.success).toBe(true);
  });

  it("接受 undefined (新流程不带 url)", () => {
    const r = attachmentUrlSchema.safeParse(undefined);
    expect(r.success).toBe(true);
  });

  it("拒绝纯文件名 (不是 URL 也不是相对路径)", () => {
    const r = attachmentUrlSchema.safeParse("file.pdf");
    expect(r.success).toBe(false);
  });

  it("拒绝协议错误的字符串", () => {
    const r = attachmentUrlSchema.safeParse("javascript:alert(1)");
    expect(r.success).toBe(false);
  });
});

// 集成到合同 attachment schema 的回归点
describe("contract attachment with legacy url", async () => {
  const { contractUpdateSchema } = await import("@/lib/validators/contract");
  it("PATCH 携带 legacy 附件 (url: /upload/...) 不再 400", () => {
    const r = contractUpdateSchema.safeParse({
      attachments: [
        {
          id: "legacy-xxx",
          url: "/upload/legacy-file.pdf",
          name: "legacy-file.pdf",
          size: 0,
          mimeType: "application/octet-stream",
          uploadedAt: "2026-06-15T07:54:02.467Z",
          uploadedBy: "legacy"
        }
      ]
    });
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("PATCH 携带新流程附件 (无 url) 仍能通过", () => {
    const r = contractUpdateSchema.safeParse({
      attachments: [
        {
          id: "cm-real-001",
          name: "test.pdf",
          size: 1024,
          mimeType: "application/pdf",
          uploadedAt: "2026-06-16T08:00:00.000Z",
          uploadedBy: "user-1"
        }
      ]
    });
    expect(r.success).toBe(true);
  });

  it("PATCH 携带 placeholder.local 绝对 URL 仍能通过", () => {
    const r = contractUpdateSchema.safeParse({
      attachments: [
        {
          id: "legacy-002",
          url: "https://placeholder.local/old.pdf",
          name: "old.pdf",
          size: 0,
          mimeType: "application/octet-stream",
          uploadedAt: "2026-06-15T07:54:02.467Z",
          uploadedBy: "legacy"
        }
      ]
    });
    expect(r.success).toBe(true);
  });
});
