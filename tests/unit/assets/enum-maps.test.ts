// 枚举映射必须中文全覆盖(否则下拉框会显示原始 enum code)
import { describe, it, expect } from "vitest";
import { ASSET_TYPE_MAP, ASSET_STATUS_MAP, SERVICE_TYPE_MAP, SERVICE_TYPE_OPTIONS } from "@/lib/enum-maps";
import { ASSET_TYPE, ASSET_STATUS, SERVICE_TYPE } from "@/types/enums";

describe("enum-maps 中文映射完整性", () => {
  it("ASSET_TYPE 10 种全部有中文 label (8 原有 + PERSONNEL_CERT + TEMPLATE)", () => {
    expect(ASSET_TYPE.length).toBe(10);
    for (const t of ASSET_TYPE) {
      expect(ASSET_TYPE_MAP[t], `${t} 缺中文`).toBeDefined();
      expect(ASSET_TYPE_MAP[t]).not.toBe(t);
    }
  });

  it("ASSET_STATUS 4 种全部有中文 label", () => {
    expect(ASSET_STATUS.length).toBe(4);
    for (const s of ASSET_STATUS) {
      expect(ASSET_STATUS_MAP[s], `${s} 缺中文`).toBeDefined();
    }
  });

  it("SERVICE_TYPE 10 种 seed + 22 个 LEGACY-* 全部有中文 label", () => {
    expect(SERVICE_TYPE.length).toBe(10); // seed only
    for (const s of SERVICE_TYPE) {
      expect(SERVICE_TYPE_MAP[s], `${s} 缺中文`).toBeDefined();
      expect(SERVICE_TYPE_MAP[s]).not.toBe(s);
    }
  });

  it("SERVICE_TYPE_OPTIONS 派生自 SERVICE_TYPE_MAP,值-标签一一对应", () => {
    expect(SERVICE_TYPE_OPTIONS.length).toBe(Object.keys(SERVICE_TYPE_MAP).length); // 32 (10 seed + 22 legacy)
    for (const opt of SERVICE_TYPE_OPTIONS) {
      expect(SERVICE_TYPE_MAP[opt.value]).toBe(opt.label);
    }
  });
});
