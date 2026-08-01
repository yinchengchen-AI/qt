import { describe, it, expect } from "vitest";
import { buildDictTree, type DictFlatRow } from "@/lib/dict-tree";

const row = (code: string, label: string, parentCode: string | null): DictFlatRow => ({
  id: `id-${code}`,
  code,
  label,
  parentCode,
  sort: 0,
  isActive: true
});

describe("buildDictTree (REGION 字典)", () => {
  const sample: DictFlatRow[] = [
    row("R1", "杭州市", null),
    row("R1.2", "余杭区", "R1"),
    row("R1.25", "临平区", "R1"),
    row("R2.4", "余杭区 · 黄湖镇", "R1.2"),
    row("R2.5", "余杭区 · 百丈镇", "R1.2"),
    row("R2.10", "余杭区 · 中泰街道", "R1.2"),
    row("R25.3", "临平区 · 临平街道", "R1.25"),
    row("R25.17", "临平区 · 运河街道", "R1.25")
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
    const r12 = tree[0]!.children[0]!;
    expect(r12.children.map((s) => s.code)).toEqual(["R2.4", "R2.5", "R2.10"]);
  });

  it("叶子节点 children 为空数组", () => {
    const tree = buildDictTree(sample);
    const leaves = tree[0]!.children.flatMap((c) => c.children);
    for (const leaf of leaves) {
      expect(leaf.children).toEqual([]);
    }
  });

  it("孤儿节点 (parentCode 引用不存在的 code) 作为顶级", () => {
    const tree = buildDictTree([row("A", "A", null), row("ORPHAN", "ORPHAN", "GHOST")]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.code)).toEqual(["A", "ORPHAN"]);
  });

  it("空数组返回空数组", () => {
    expect(buildDictTree([])).toEqual([]);
  });

  it("只有顶级时返回平铺顶级列表", () => {
    const tree = buildDictTree([row("A", "A", null), row("B", "B", null)]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});
