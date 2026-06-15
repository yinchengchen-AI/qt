import { describe, it, expect } from "vitest";
import { presignUploadBodySchema } from "@/lib/validators/upload";

describe("presignUploadBodySchema", () => {
  const base = { filename: "x.pdf", mimeType: "application/pdf", size: 1024 };

  it("accepts payload with only assetId", () => {
    const r = presignUploadBodySchema.safeParse({ ...base, assetId: "att-1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assetId).toBe("att-1");
  });
  it("accepts payload with assetId + contractId (冗余允许)", () => {
    const r = presignUploadBodySchema.safeParse({
      ...base, assetId: "a", contractId: "c"
    });
    expect(r.success).toBe(true);
  });
  it("accepts payload with all ids null (tmp/ 路径)", () => {
    const r = presignUploadBodySchema.safeParse({
      ...base, contractId: null, invoiceId: null, assetId: null
    });
    expect(r.success).toBe(true);
  });
  it("rejects missing filename", () => {
    const r = presignUploadBodySchema.safeParse({ mimeType: "x", size: 1 });
    expect(r.success).toBe(false);
  });
  it("rejects negative size", () => {
    const r = presignUploadBodySchema.safeParse({ ...base, size: -1 });
    expect(r.success).toBe(false);
  });
});
