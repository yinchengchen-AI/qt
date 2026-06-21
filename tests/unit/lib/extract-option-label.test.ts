// 回归 #2:ProFormSelect 搜索后 onChange 收到的 option.label 是 React element
// (用来高亮匹配子串),typeof === "string" 守卫会拿到 React node 对象,导致
// 一键复制按钮不显示、tryAutoFill 收到空串而不写标题。
//
// 这里锁住 extractOptionLabel 的行为:
//   1) 主路径:用 value 在外部 id->name map 里查
//   2) 兜底:option.name / option.title / string 类型的 option.label
//   3) React element 形态的 label 永远不直接采用(它会绕过类型守卫)
import { describe, it, expect } from "vitest";
import { extractOptionLabel } from "@/lib/extract-option-label";

// 构造一个模拟 ProFormSelect 搜索后传回的 option.label(被改写成 React element)
const fakeReactElement = {
  $$typeof: Symbol.for("react.transitional.element"),
  type: "span",
  key: null,
  ref: null,
  props: { children: ["锦城", "矿业有限责任公司"] },
  _owner: null
};

describe("extractOptionLabel", () => {
  const map = new Map<string, string>([["cm123", "锦城矿业有限责任公司"]]);

  it("主路径:value 在 id->name map 里时直接返回原始字符串", () => {
    expect(extractOptionLabel("cm123", { label: fakeReactElement }, map)).toBe("锦城矿业有限责任公司");
  });

  it("不搜索时 option.label 是 string,直接采用", () => {
    expect(extractOptionLabel("cm123", { label: "锦城矿业有限责任公司" })).toBe("锦城矿业有限责任公司");
  });

  it("option.name 字段作为字符串备份(主路径失败时)", () => {
    // 模拟 map 还没填充(异步 fetch 比 click 慢)的情况
    const emptyMap = new Map<string, string>();
    expect(extractOptionLabel("cm123", { label: fakeReactElement, name: "锦城矿业有限责任公司" }, emptyMap)).toBe("锦城矿业有限责任公司");
  });

  it("option.title 字段作为字符串备份", () => {
    expect(extractOptionLabel("cm123", { label: fakeReactElement, title: "锦城矿业有限责任公司" })).toBe("锦城矿业有限责任公司");
  });

  it("React element 形态的 label 永远不直接采用(避免把高亮 node 当字符串)", () => {
    // 即使 option 没有 name/title 备份,且 map 也没命中,也不应该返回那个 React node
    const result = extractOptionLabel("cm-unknown", { label: fakeReactElement }, new Map());
    expect(typeof result).toBe("string");
    expect(result).toBe("");
  });

  it("value 不在 map 且 option 无字符串字段时,返回空串", () => {
    expect(extractOptionLabel("unknown", undefined, new Map())).toBe("");
    expect(extractOptionLabel("unknown", null, new Map())).toBe("");
    expect(extractOptionLabel(undefined, { label: fakeReactElement })).toBe("");
  });

  it("value 不是 string 时跳过 map 查询(只走 option 兜底)", () => {
    expect(extractOptionLabel(12345, { label: "锦城矿业有限责任公司" })).toBe("锦城矿业有限责任公司");
    expect(extractOptionLabel(null, { label: "锦城矿业有限责任公司" })).toBe("锦城矿业有限责任公司");
  });

  it("option 不是对象时返回空串", () => {
    expect(extractOptionLabel("cm123", "not-an-object", map)).toBe("锦城矿业有限责任公司"); // map 优先
    expect(extractOptionLabel("unknown", "not-an-object", new Map())).toBe("");
  });

  it("空字符串的 name/title 视为不存在,继续往后找", () => {
    expect(extractOptionLabel("cm123", { label: fakeReactElement, name: "", title: "锦城矿业有限责任公司" })).toBe("锦城矿业有限责任公司");
  });

  it("主路径 > name > title > label 的优先级", () => {
    const localMap = new Map([["id1", "fromMap"]]);
    const result = extractOptionLabel(
      "id1",
      { label: "fromLabel", name: "fromName", title: "fromTitle" },
      localMap
    );
    expect(result).toBe("fromMap");
  });
});
