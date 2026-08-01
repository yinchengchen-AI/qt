/**
 * 把扁平字典 (有 parentCode 字段) 拼成 antd TreeData 格式
 *   顶级: { code, label, children: [...] }
 *   子级递归
 *   parentCode 引用不存在的 code 会被忽略 (作为顶级)
 */
export type DictTreeNode = {
  id: string;
  code: string;
  label: string;
  parentCode: string | null;
  isActive: boolean;
  children: DictTreeNode[];
};

export type DictFlatRow = {
  id: string;
  code: string;
  label: string;
  parentCode: string | null;
  sort: number;
  isActive: boolean;
};

export function buildDictTree(flat: DictFlatRow[]): DictTreeNode[] {
  type Node = DictTreeNode & { _raw: DictFlatRow };
  const map = new Map<string, Node>();
  for (const f of flat) {
    map.set(f.code, {
      id: f.id,
      code: f.code,
      label: f.label,
      parentCode: f.parentCode,
      isActive: f.isActive,
      children: [],
      _raw: f
    });
  }
  const roots: Node[] = [];
  for (const f of flat) {
    const node = map.get(f.code)!;
    if (f.parentCode && map.has(f.parentCode)) {
      map.get(f.parentCode)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // UI 只要 code/label/children (去除内部 _raw)
  return roots.map(({ id, code, label, parentCode, isActive, children }) => ({
    id,
    code,
    label,
    parentCode,
    isActive,
    children
  }));
}
