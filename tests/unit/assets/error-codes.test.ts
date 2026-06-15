import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@/types/errors";

describe("bid asset library v1 error codes", () => {
  const REQUIRED: ErrorCode[] = [
    "ASSET_ATTACHMENT_REQUIRED",
    "ASSET_USER_INVALID",
    "ASSET_SERVICE_TYPE_INVALID"
  ] as ErrorCode[];

  for (const code of REQUIRED) {
    it(`has ERROR_CODES.${code} constant`, () => {
      expect(ERROR_CODES[code]).toBe(code);
    });
    it(`has ERROR_MESSAGES.${code} user-facing message`, () => {
      expect(ERROR_MESSAGES[code], `缺 ${code} 的中文文案`).toBeDefined();
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    });
  }
});
