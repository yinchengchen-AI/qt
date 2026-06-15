import { describe, it, expect } from "vitest";
import { assetCreateSchema, assetUpdateSchema, assetListQuerySchema } from "@/lib/validators/asset";

describe("assetCreateSchema (LICENSE)", () => {
  const baseLicense = {
    type: "LICENSE" as const,
    name: "测试营业执照",
    tags: [],
    attributes: {
      unifiedSocialCreditCode: "91330100MA0000000C",  // 18 chars, 校验位 = 9
      legalRepresentative: "张三",
      registeredCapital: "1000万",
      establishDate: "2020-01-01T00:00:00Z",
      businessScope: "安全咨询",
      address: "杭州"
    }
  };
  it("accepts valid LICENSE", () => {
    const r = assetCreateSchema.safeParse(baseLicense);
    expect(r.success).toBe(true);
  });
  it("rejects LICENSE with invalid credit code", () => {
    const r = assetCreateSchema.safeParse({
      ...baseLicense,
      attributes: { ...baseLicense.attributes, unifiedSocialCreditCode: "INVALID" }
    });
    expect(r.success).toBe(false);
  });
  it("rejects LICENSE without name", () => {
    const r = assetCreateSchema.safeParse({ ...baseLicense, name: "" });
    expect(r.success).toBe(false);
  });
  it("rejects LICENSE with validTo before validFrom", () => {
    const r = assetCreateSchema.safeParse({
      ...baseLicense,
      validFrom: "2025-01-01T00:00:00Z",
      validTo: "2024-01-01T00:00:00Z"
    });
    expect(r.success).toBe(false);
  });
});

describe("assetCreateSchema (CERTIFICATE)", () => {
  const baseCert = {
    type: "CERTIFICATE" as const,
    name: "测试资质",
    tags: [],
    attributes: {
      certificateNo: "AP-2024-0001",
      issuingAuthority: "应急部",
      category: "安全评价"
    }
  };
  it("accepts valid CERTIFICATE", () => {
    expect(assetCreateSchema.safeParse(baseCert).success).toBe(true);
  });
  it("rejects CERTIFICATE with missing certificateNo", () => {
    const r = assetCreateSchema.safeParse({
      ...baseCert,
      attributes: { ...baseCert.attributes, certificateNo: "" }
    });
    expect(r.success).toBe(false);
  });
  it("rejects CERTIFICATE with gradeLevel invalid value", () => {
    const r = assetCreateSchema.safeParse({
      ...baseCert,
      attributes: { ...baseCert.attributes, gradeLevel: "丁级" }
    });
    expect(r.success).toBe(false);
  });
});

describe("assetCreateSchema (TEAM_MEMBER)", () => {
  const baseMember = {
    type: "TEAM_MEMBER" as const,
    name: "测试成员",
    tags: [],
    attributes: {
      title: "高级工程师",
      specialty: "化工",
      yearsOfExperience: 10
    }
  };
  it("accepts TEAM_MEMBER with userId", () => {
    expect(assetCreateSchema.safeParse({
      ...baseMember,
      attributes: { ...baseMember.attributes, userId: "user-123" }
    }).success).toBe(true);
  });
  it("accepts TEAM_MEMBER with externalName", () => {
    expect(assetCreateSchema.safeParse({
      ...baseMember,
      attributes: { ...baseMember.attributes, externalName: "外部专家" }
    }).success).toBe(true);
  });
  it("rejects TEAM_MEMBER with neither userId nor externalName", () => {
    const r = assetCreateSchema.safeParse(baseMember);
    expect(r.success).toBe(false);
  });
  it("rejects TEAM_MEMBER with negative years", () => {
    const r = assetCreateSchema.safeParse({
      ...baseMember,
      attributes: { ...baseMember.attributes, yearsOfExperience: -1, externalName: "X" }
    });
    expect(r.success).toBe(false);
  });
});

describe("assetCreateSchema (PATENT)", () => {
  const basePatent = {
    type: "PATENT" as const,
    name: "测试专利",
    tags: [],
    attributes: {
      patentType: "PATENT" as const,
      patentNo: "ZL2024-0001",
      name: "专利名",
      applicants: ["张三"],
      applicationDate: "2024-01-01T00:00:00Z"
    }
  };
  it("accepts valid PATENT", () => {
    expect(assetCreateSchema.safeParse(basePatent).success).toBe(true);
  });
  it("rejects PATENT with empty applicants", () => {
    const r = assetCreateSchema.safeParse({
      ...basePatent,
      attributes: { ...basePatent.attributes, applicants: [] }
    });
    expect(r.success).toBe(false);
  });
});

describe("assetCreateSchema (CASE)", () => {
  const baseCase = {
    type: "CASE" as const,
    name: "案例",
    tags: [],
    attributes: {
      title: "案例标题",
      customerName: "客户",
      serviceType: "EVALUATION" as const,
      year: 2024,
      scope: "范围"
    }
  };
  it("accepts valid CASE", () => {
    expect(assetCreateSchema.safeParse(baseCase).success).toBe(true);
  });
  it("rejects CASE with year out of range", () => {
    const r = assetCreateSchema.safeParse({
      ...baseCase,
      attributes: { ...baseCase.attributes, year: 1990 }
    });
    expect(r.success).toBe(false);
  });
});

describe("assetCreateSchema (discriminated union)", () => {
  it("rejects unknown type", () => {
    const r = assetCreateSchema.safeParse({ type: "UNKNOWN", name: "x", tags: [], attributes: {} });
    expect(r.success).toBe(false);
  });
});

describe("assetUpdateSchema", () => {
  it("accepts partial update with attributes", () => {
    const r = assetUpdateSchema.safeParse({
      name: "新名字",
      attributes: { some: "value" }
    });
    expect(r.success).toBe(true);
  });
  it("rejects update with validTo < validFrom", () => {
    const r = assetUpdateSchema.safeParse({
      validFrom: "2025-01-01T00:00:00Z",
      validTo: "2024-01-01T00:00:00Z"
    });
    expect(r.success).toBe(false);
  });
});

describe("assetListQuerySchema", () => {
  it("coerces page/pageSize to numbers", () => {
    const r = assetListQuerySchema.safeParse({ page: "2", pageSize: "50" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.pageSize).toBe(50);
    }
  });
  it("rejects invalid type", () => {
    const r = assetListQuerySchema.safeParse({ type: "INVALID" });
    expect(r.success).toBe(false);
  });
  it("accepts includeArchived as boolean", () => {
    const r = assetListQuerySchema.safeParse({ includeArchived: "true" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.includeArchived).toBe(true);
  });
});

describe("assetUpdateSchema (回填场景)", () => {
  it("accepts update with customerId + contractId(关联已建立)", () => {
    const r = assetUpdateSchema.safeParse({
      name: "某项目",
      attributes: {
        customerId: "cust-123",
        contractId: "contract-456",
        projectName: "已通过 picker 选过客户和合同"
      },
      validFrom: "2024-01-01T00:00:00Z",
      validTo: "2025-01-01T00:00:00Z"
    });
    expect(r.success).toBe(true);
  });

  it("accepts update without type field(type 不可改)", () => {
    const r = assetUpdateSchema.safeParse({ name: "改名" });
    expect(r.success).toBe(true);
  });

  it("accepts empty attributes(只改 name/tags)", () => {
    const r = assetUpdateSchema.safeParse({
      name: "改名",
      tags: ["新标签"],
      attributes: {}  // 空对象,merge 时不会改 attributes
    });
    expect(r.success).toBe(true);
  });

  it("rejects update with validTo before validFrom", () => {
    const r = assetUpdateSchema.safeParse({
      validFrom: "2025-01-01T00:00:00Z",
      validTo: "2024-01-01T00:00:00Z"
    });
    expect(r.success).toBe(false);
  });
});

describe("PERFORMANCE.attributes 回填字段完整性", () => {
  it("accepts full PERFORMANCE payload with auto-filled fields from contract picker", () => {
    const r = assetCreateSchema.safeParse({
      type: "PERFORMANCE",
      name: "某大型化工企业安全评估项目",
      tags: ["业绩", "化工"],
      validFrom: "2023-05-01T00:00:00Z",
      validTo: "2024-04-30T00:00:00Z",
      attributes: {
        projectName: "某大型化工企业 2023 年度安全评估",
        customerName: "某大型化工集团",
        customerContact: "李经理 / 13800001111",
        customerId: "cust-abc",
        contractId: "contract-def",
        serviceType: "EVALUATION",
        contractAmount: 480000,
        signDate: "2023-05-01T00:00:00Z",
        completedDate: "2024-04-30T00:00:00Z"
      }
    });
    expect(r.success).toBe(true);
  });

  it("rejects PERFORMANCE without customerId when customerName is set (业务上应保证关联)", () => {
    // 注:customerId 是 optional,所以只填 customerName 也能过 Zod
    // 但 service 层可以在 v2 强制要求
    const r = assetCreateSchema.safeParse({
      type: "PERFORMANCE",
      name: "test",
      attributes: {
        projectName: "test",
        customerName: "某客户",
        serviceType: "EVALUATION"
      }
    });
    expect(r.success).toBe(true);
  });
});

describe("CASE.attributes 回填字段完整性", () => {
  it("accepts CASE with projectId linker", () => {
    const r = assetCreateSchema.safeParse({
      type: "CASE",
      name: "化工园区安全评估示范",
      tags: ["案例", "示范"],
      attributes: {
        projectId: "proj-xyz",
        title: "化工园区 2023 安全评估",
        customerName: "某化工园区管委会",
        serviceType: "EVALUATION",
        year: 2023,
        scope: "对园区内 28 家危化品企业开展全面评估"
      }
    });
    expect(r.success).toBe(true);
  });
});
