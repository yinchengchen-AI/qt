import { describe, it, expect } from "vitest";
import { presignUploadBodySchema } from "@/lib/validators/upload";

describe("presignUploadBodySchema (PR6)", () => {
  const base = { filename: "test.png", mimeType: "image/png", size: 1024 };

  it("accepts valid category", () => {
    expect(() => presignUploadBodySchema.parse({ ...base, category: "AVATAR" })).not.toThrow();
    expect(() => presignUploadBodySchema.parse({ ...base, category: "ID_CARD_FRONT" })).not.toThrow();
    expect(() => presignUploadBodySchema.parse({ ...base, category: "ID_CARD_BACK" })).not.toThrow();
    expect(() => presignUploadBodySchema.parse({ ...base, category: "CERTIFICATE" })).not.toThrow();
  });

  it("rejects invalid category", () => {
    expect(() => presignUploadBodySchema.parse({ ...base, category: "BOGUS" })).toThrow();
  });

  it("defaults category to GENERAL when omitted", () => {
    const out = presignUploadBodySchema.parse(base);
    expect(out.category).toBe("GENERAL");
  });
});
