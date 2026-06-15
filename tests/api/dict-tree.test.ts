import { describe, it, expect } from "vitest";

/** 复刻 buildDictTree 逻辑(避免引 server module) */
type DictTreeNode = { code: string; label: string; children: DictTreeNode[] };
function buildDictTree<T extends { code: string; label: string; parentCode: string | null }>(
  flat: T[]
): DictTreeNode[] {
  type Node = DictTreeNode;
  const map = new Map<string, Node>();
  for (const f of flat) map.set(f.code, { code: f.code, label: f.label, children: [] });
  const roots: Node[] = [];
  for (const f of flat) {
    const node = map.get(f.code)!;
    if (f.parentCode && map.has(f.parentCode)) {
      map.get(f.parentCode)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

describe("buildDictTree (REGION 字典)", () => {
  const sample = [
    { code: "R1", label: "杭州市", parentCode: null },
    { code: "R1.2", label: "余杭区", parentCode: "R1" },
    { code: "R1.25", label: "临平区", parentCode: "R1" },
    { code: "R2.4", label: "余杭区 · 黄湖镇", parentCode: "R1.2" },
    { code: "R2.5", label: "余杭区 · 百丈镇", parentCode: "R1.2" },
    { code: "R2.10", label: "余杭区 · 中泰街道", parentCode: "R1.2" },
    { code: "R25.3", label: "临平区 · 临平街道", parentCode: "R1.25" },
    { code: "R25.17", label: "临平区 · 运河街道", parentCode: "R1.25" }
  ];

  it("3 级嵌套: 杭州 > 余杭/临平 > 街道", () => {
    const tree = buildDictTree(sample);
    expect(tree).toHaveLength(1);
    const r1 = tree[0]!;
    expect(r1.code).toBe("R1");
    expect(r1.children).toHaveLength(2);
    const r12 = r1.children[0]!;
    expect(r12.code).toBe("R1.2");
    expect(r12.children).toHaveLength(3);
  });

  it("子级按原数组顺序保留(不重新排序)", () => {
    const tree = buildDictTree(sample);
    const r1 = tree[0]!;
    const r12 = r1.children[0]!;
    const subs = r12.children;
    expect(subs.map((s) => s.code)).toEqual(["R2.4", "R2.5", "R2.10"]);
  });

  it("叶子节点 children 为空数组", () => {
    const tree = buildDictTree(sample);
    const r1 = tree[0]!;
    const leaves = r1.children.flatMap((c) => c.children);
    for (const leaf of leaves) {
      expect(leaf.children).toEqual([]);
    }
  });

  it("孤儿节点 (parentCode 引用不存在的 code) 作为顶级", () => {
    const tree = buildDictTree([
      { code: "A", label: "A", parentCode: null },
      { code: "ORPHAN", label: "ORPHAN", parentCode: "GHOST" }
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.code)).toEqual(["A", "ORPHAN"]);
  });

  it("空数组返回空数组", () => {
    expect(buildDictTree([])).toEqual([]);
  });

  it("只有顶级时返回平铺顶级列表", () => {
    const tree = buildDictTree([
      { code: "A", label: "A", parentCode: null },
      { code: "B", label: "B", parentCode: null }
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});
