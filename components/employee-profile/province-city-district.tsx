"use client";
import { Cascader } from "antd";
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

export function ProvinceCityDistrict({ value, onChange, disabled }: Props) {
  const cascaderValue: string[] = [];
  if (value?.province) {
    const p = findPath(options, value.province);
    if (p) cascaderValue.push(...p);
  }
  return (
    <Cascader
      options={options}
      disabled={disabled}
      value={cascaderValue}
      onChange={(arr: string[]) => onChange?.({
        province: arr[0],
        city: arr[1],
        district: arr[2]
      })}
      placeholder="请选择省 / 市 / 区（必填）"
      changeOnSelect={false}
      showSearch
    />
  );
}
