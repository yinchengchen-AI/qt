// 回归: list endpoint schema pageSize max 必须 ≥ 下拉场景需要的 pageSize
//
// 背景: v0.7.0 部署后, aging 页面的 负责人/客户 下拉 SWR 调用
//   /api/users?pageSize=200   /api/customers?pageSize=200
// 被 userListQuerySchema / customerListQuerySchema 的 max(100) 拒绝,
// SWR 的 onError 静默吞掉异常, 下拉空 options,
// 用户报'客户和负责人没有关联数据'。
//
// 修复: schema 升到 max(1000), 跟 contract schema 的现有约定对齐
// (开票新建页合同下拉一次性加载所有 ACTIVE 合同, max=1000)。
//
// 本测试: 三个 list schema 的 pageSize 在 100 / 200 / 500 / 1000 都应 OK,
// 防止以后 max 退回到 100 又踩同一个坑。

import { describe, it, expect } from "vitest";
import { userListQuerySchema } from "@/lib/validators/user";
import { customerListQuerySchema } from "@/lib/validators/customer";
import { contractListQuerySchema } from "@/lib/validators/contract";

const VALUES = [100, 200, 500, 1000];

describe("user/customer/contract pageSize 边界 (回归 v0.7.0 42501 + dropdown empty 事故)", () => {
  for (const v of VALUES) {
    it(`userListQuerySchema accepts pageSize=${v}`, () => {
      const r = userListQuerySchema.safeParse({ pageSize: v });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.pageSize).toBe(v);
    });
    it(`customerListQuerySchema accepts pageSize=${v}`, () => {
      const r = customerListQuerySchema.safeParse({ pageSize: v });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.pageSize).toBe(v);
    });
    it(`contractListQuerySchema accepts pageSize=${v}`, () => {
      const r = contractListQuerySchema.safeParse({ pageSize: v });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.pageSize).toBe(v);
    });
  }

  it("default pageSize is 20 for all three", () => {
    expect(userListQuerySchema.parse({}).pageSize).toBe(20);
    expect(customerListQuerySchema.parse({}).pageSize).toBe(20);
    expect(contractListQuerySchema.parse({}).pageSize).toBe(20);
  });
});
