import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES } from "@/types/errors";

describe("DINGTALK_* error codes", () => {
  const expected = [
    "DINGTALK_NOT_CONFIGURED",
    "DINGTALK_UPSTREAM_ERROR",
    "DINGTALK_STATE_NOT_FOUND",
    "DINGTALK_QR_EXPIRED",
    "DINGTALK_STATE_NOT_READY",
    "DINGTALK_STATE_CONSUMED",
    "DINGTALK_PHONE_NOT_REGISTERED",
    "DINGTALK_PHONE_AMBIGUOUS",
    "DINGTALK_USER_DISABLED",
  ];
  for (const code of expected) {
    it("code " + code + " registered", () => {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toBe(code);
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBeTruthy();
    });
  }
});
