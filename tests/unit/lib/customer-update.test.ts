import { describe, it, expect } from "vitest";
import { buildCustomerUpdateData } from "@/lib/customer-update";

describe("buildCustomerUpdateData", () => {
  it("部分更新: 只传 name 时, 其它可空字段不进入 data (不会把 DB 旧值擦成 null)", () => {
    const data = buildCustomerUpdateData({ name: "新名字" }, "user-1") as Record<string, unknown>;
    expect(data.name).toBe("新名字");
    expect(data.updatedById).toBe("user-1");
    // 关键: 这些字段在 input 中未出现, data 里就不应该有它们
    expect("shortName" in data).toBe(false);
    expect("industry" in data).toBe(false);
    expect("scale" in data).toBe(false);
    expect("address" in data).toBe(false);
    expect("contactName" in data).toBe(false);
    expect("contactTitle" in data).toBe(false);
    expect("sourceChannel" in data).toBe(false);
    expect("unifiedSocialCreditCode" in data).toBe(false);
  });

  it("字符串型字段传空串归一为 null (用于清空该字段)", () => {
    const data = buildCustomerUpdateData({
      name: "X",
      shortName: "",
      industry: "",
      address: ""
    }, "u") as Record<string, unknown>;
    expect(data.shortName).toBeNull();
    expect(data.industry).toBeNull();
    expect(data.address).toBeNull();
  });

  it("字符串型字段正常字符串原样透传", () => {
    const data = buildCustomerUpdateData({
      shortName: "简称",
      industry: "IT",
      contactName: "张三"
    }, "u") as Record<string, unknown>;
    expect(data.shortName).toBe("简称");
    expect(data.industry).toBe("IT");
    expect(data.contactName).toBe("张三");
  });

  it("status 永远不会被写入 (必须经 changeCustomerStatus 走业务规则)", () => {
    // 即便调用方传了 status, 也不能让它绕过 R-02 / R-13 校验
    const data = buildCustomerUpdateData(
      { name: "X", status: "SIGNED" } as never,
      "u"
    ) as Record<string, unknown>;
    expect("status" in data).toBe(false);
  });

  it("updatedById 总是写入", () => {
    expect((buildCustomerUpdateData({}, "u") as Record<string, unknown>).updatedById).toBe("u");
    expect((buildCustomerUpdateData({ name: "X" }, "u2") as Record<string, unknown>).updatedById).toBe("u2");
  });

  it("枚举字段透传 (不过 nullish 归一)", () => {
    const data = buildCustomerUpdateData({
      customerType: "GOV",
      scale: "LARGE"
    }, "u") as Record<string, unknown>;
    expect(data.customerType).toBe("GOV");
    expect(data.scale).toBe("LARGE");
  });

  it("ownerUserId 透传", () => {
    const data = buildCustomerUpdateData({ ownerUserId: "user-99" }, "u") as Record<string, unknown>;
    expect(data.ownerUserId).toBe("user-99");
  });

  it("undefined 值不进 data (与 'key 不存在' 同义)", () => {
    const data = buildCustomerUpdateData({ shortName: undefined }, "u") as Record<string, unknown>;
    expect("shortName" in data).toBe(false);
  });
});
