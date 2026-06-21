"use client";

import { Cascader } from "antd";
import { DIVISIONS, type DivisionNode } from "@/lib/china-divisions";

type Props = {
  value?: string[];
  onChange?: (labels: string[], selectedOptions: DivisionNode[]) => void;
  placeholder?: string;
  size?: "large" | "middle" | "small";
  /**
   * 自定义数据源. 默认全量 DIVISIONS (全国省/市/区/镇街).
   * 客户管理只用浙江省时, 传 ZHEJIANG_DIVISIONS 即可限制选项.
   */
  options?: DivisionNode[];
};

export function LocationCascader({
  value,
  onChange,
  placeholder = "选择省 / 市 / 区 / 镇街",
  size = "large",
  options = DIVISIONS
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
      options={options}
      placeholder={placeholder}
      size={size}
      style={{ width: "100%" }}
      changeOnSelect
      fieldNames={{ label: "label", value: "value", children: "children" }}
    />
  );
}
