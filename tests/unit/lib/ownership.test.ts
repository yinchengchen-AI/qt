// assertRecordWritable 写守门回归 (role-browse-permissions todo 1)
//
//   业务浏览读路径对 SALES/EXPERT 全量放开后, 写路径统一收口到
//   assertRecordWritable: 受限角色 (SALES/EXPERT) 只能写自己 owner 的记录,
//   写他人/无 owner 的记录一律 403; 非受限角色 (ADMIN/FINANCE/OPS) 放行。

import { describe, it, expect } from "vitest";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { assertRecordWritable } from "@/lib/ownership";

function mkUser(roleCode: SessionUser["roleCode"], id = `user-${roleCode.toLowerCase()}`): SessionUser {
  return { id, employeeNo: id, name: id, email: `${id}@t.local`, roleCode, permissions: [] };
}

describe("assertRecordWritable 写守门", () => {
  it("SALES / EXPERT 写自己的记录 → 不抛", () => {
    const sales = mkUser("SALES", "sales-1");
    const expert = mkUser("EXPERT", "expert-1");
    expect(() => assertRecordWritable(sales, "sales-1", "客户")).not.toThrow();
    expect(() => assertRecordWritable(expert, "expert-1", "合同")).not.toThrow();
  });

  it("SALES / EXPERT 写他人的记录 → 抛 ApiError 403 且 message 含「无权操作他人」与名词", () => {
    const sales = mkUser("SALES", "sales-1");
    const expert = mkUser("EXPERT", "expert-1");

    let salesErr: unknown;
    try {
      assertRecordWritable(sales, "other-user", "客户");
    } catch (e) {
      salesErr = e;
    }
    expect(salesErr).toBeInstanceOf(ApiError);
    const se = salesErr as ApiError;
    expect(se.status).toBe(403);
    expect(se.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(se.message).toContain("无权操作他人");
    expect(se.message).toContain("客户");

    let expertErr: unknown;
    try {
      assertRecordWritable(expert, "other-user", "合同");
    } catch (e) {
      expertErr = e;
    }
    expect(expertErr).toBeInstanceOf(ApiError);
    const ee = expertErr as ApiError;
    expect(ee.status).toBe(403);
    expect(ee.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(ee.message).toContain("无权操作他人");
    expect(ee.message).toContain("合同");
  });

  it("ADMIN / FINANCE / OPS 写他人记录 → 不抛", () => {
    expect(() => assertRecordWritable(mkUser("ADMIN"), "other-user", "客户")).not.toThrow();
    expect(() => assertRecordWritable(mkUser("FINANCE"), "other-user", "发票")).not.toThrow();
    expect(() => assertRecordWritable(mkUser("OPS"), "other-user", "回款")).not.toThrow();
  });

  it("SALES 遇到 ownerUserId 为 null / undefined → 抛 403 (他人 ≠ 自己)", () => {
    const sales = mkUser("SALES", "sales-1");
    expect(() => assertRecordWritable(sales, null, "客户")).toThrowError(ApiError);
    expect(() => assertRecordWritable(sales, undefined, "客户")).toThrowError(ApiError);
    let nullErr: unknown;
    try {
      assertRecordWritable(sales, null, "客户");
    } catch (e) {
      nullErr = e;
    }
    expect((nullErr as ApiError).status).toBe(403);
  });
});
