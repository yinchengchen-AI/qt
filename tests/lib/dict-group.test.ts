import { describe, it, expect } from "vitest";
import { groupDictByLegacy } from "@/lib/dict-client";

describe("groupDictByLegacy", () => {
  it("把字典按 LEGACY- 前缀切成 system / legacy 两组, 并把 code 映射成 value (antd Select 兼容)", () => {
    const items = [
      { code: "SAFETY_CONSULT", label: "管理咨询" },
      { code: "HAZARD_ANA", label: "安全隐患排查" },
      { code: "LEGACY-1", label: "风险管控" },
      { code: "LEGACY-2.8", label: "社会化服务（锦泰）" },
      { code: "OTHER", label: "其他" }
    ];
    const grouped = groupDictByLegacy(items);
    expect(grouped).toHaveLength(2);

    expect(grouped[0]!.label).toBe("系统服务类型");
    expect(grouped[0]!.options).toHaveLength(3);
    // 关键: 必须是 { value, label } 而不是 { code, label }
    expect(grouped[0]!.options[0]!.value).toBe("SAFETY_CONSULT");
    expect(grouped[0]!.options[0]!.label).toBe("管理咨询");

    expect(grouped[1]!.label).toBe("历史服务类型 (FineUI 迁移)");
    expect(grouped[1]!.options).toHaveLength(2);
    expect(grouped[1]!.options[0]!.value).toBe("LEGACY-1");
    expect(grouped[1]!.options[1]!.value).toBe("LEGACY-2.8");
  });

  it("空 legacy 数组时不返回空分组", () => {
    const grouped = groupDictByLegacy([{ code: "X", label: "Y" }]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.label).toBe("系统服务类型");
    expect(grouped[0]!.options[0]!.value).toBe("X");
  });

  it("空 system 数组时不返回空分组", () => {
    const grouped = groupDictByLegacy([{ code: "LEGACY-1", label: "X" }]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.label).toBe("历史服务类型 (FineUI 迁移)");
  });

  it("支持自定义分组 label", () => {
    const items = [
      { code: "A", label: "a" },
      { code: "LEGACY-1", label: "b" }
    ];
    const grouped = groupDictByLegacy(items, { systemLabel: "内置", legacyLabel: "外采" });
    expect(grouped[0]!.label).toBe("内置");
    expect(grouped[1]!.label).toBe("外采");
  });
});
