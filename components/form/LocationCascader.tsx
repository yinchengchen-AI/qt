"use client";

import { Cascader } from "antd";
import { DIVISIONS, type DivisionNode } from "@/lib/china-divisions";

type Props = {
  /**
   * 受控值: 各级节点的 code 数组 (与 options 的 value 字段对应).
   * 不传则 Cascader 走内部 state, 不会因父组件重渲染被重置.
   */
  value?: string[];
  /**
   * onChange 第一参数是 Cascader 给的 value 路径 (code 数组),
   * 第二参数是从 selectedOptions 解出的 label 数组,
   * 第三参数是 antd 解析出的节点数组. 受控用法必须把第一参数 set 回 value state,
   * 否则 React 重渲染时 Cascader 内部选中状态会被 value 重新覆盖, 表现为"选完不显示".
   */
  onChange?: (value: string[], labels: string[], selectedOptions: DivisionNode[]) => void;
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
  // 透传 antd Cascader 的 onChange, 把 value 路径 / labels / selectedOptions 三件套都交给父组件.
  // 受控用法 (如客户编辑页) 必须拿第一参数 setCascadeValue, 不然 Cascader 内部显示会被 value prop 拉回到预填值.
  return (
    <Cascader<DivisionNode>
      value={value}
      onChange={(newValue, selectedOptions) => {
        if (!onChange || !selectedOptions) return;
        const opts = selectedOptions as DivisionNode[];
        const labels = opts.map((o) => o.label);
        onChange(newValue as string[], labels, opts);
      }}
      options={options}
      placeholder={placeholder}
      size={size}
      style={{ width: "100%" }}
      changeOnSelect
      fieldNames={{ label: "label", value: "value", children: "children" }}
    />
  );
}
