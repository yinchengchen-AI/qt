"use client";
import { Cascader } from "antd";
import { useEffect, useState } from "react";
import { DIVISIONS } from "@/lib/china-divisions";

type Value = { province?: string; city?: string; district?: string };

type Props = {
  value?: Value;
  onChange?: (v: Value) => void;
  disabled?: boolean;
};

const options = DIVISIONS;

// 从 options 树里按 value 找出完整路径(用于回显)
function findPath(nodes: typeof DIVISIONS, value: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    const next = [...path, n.value as string];
    if (n.value === value) return next;
    if (n.children) {
      const r = findPath(n.children, value, next);
      if (r) return r;
    }
  }
  return null;
}

// 按最深一级(district > city > province)找完整路径,保证三级回显
function pathFor(v?: Value): string[] {
  const deepest = v?.district ?? v?.city ?? v?.province;
  if (!deepest) return [];
  return findPath(options, deepest) ?? [];
}

export function ProvinceCityDistrict({ value, onChange, disabled }: Props) {
  // 内部持有选中路径:onChange 后立即更新显示,不等父级回传(父级经 formRef 写入,
  // props.value 可能滞后或不变,纯受控会把用户的选择回退掉)
  const province = value?.province;
  const city = value?.city;
  const district = value?.district;
  const [inner, setInner] = useState<string[]>(() => pathFor({ province, city, district }));
  useEffect(() => {
    setInner(pathFor({ province, city, district }));
  }, [province, city, district]);
  return (
    <Cascader
      options={options}
      disabled={disabled}
      value={inner}
      onChange={(arr: string[]) => {
        setInner(arr);
        onChange?.({
          province: arr[0],
          city: arr[1],
          district: arr[2]
        });
      }}
      placeholder="请选择省 / 市 / 区（必填）"
      changeOnSelect={false}
      showSearch
    />
  );
}
