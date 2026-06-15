"use client";

import { Cascader } from "antd";
import { DIVISIONS, type DivisionNode } from "@/lib/china-divisions";

type Props = {
  value?: string[];
  onChange?: (labels: string[], selectedOptions: DivisionNode[]) => void;
  placeholder?: string;
  size?: "large" | "middle" | "small";
};

export function LocationCascader({
  value,
  onChange,
  placeholder = "选择省 / 市 / 区 / 镇街",
  size = "large"
}: Props) {
  const handleChange = (_value: unknown, selectedOptions: unknown) => {
    if (!onChange || !selectedOptions) return;
    const opts = selectedOptions as DivisionNode[];
    const labels = opts.map((o) => o.label);
    onChange(labels, opts);
  };

  return (
    <Cascader<DivisionNode>
      value={value}
      onChange={handleChange}
      options={DIVISIONS}
      placeholder={placeholder}
      size={size}
      style={{ width: "100%" }}
      changeOnSelect
      fieldNames={{ label: "label", value: "value", children: "children" }}
    />
  );
}
