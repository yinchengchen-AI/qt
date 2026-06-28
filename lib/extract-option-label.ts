// 从 antd / ProFormSelect onChange 的 (value, option) 第二个参数里提取纯字符串 label。
//
// 背景:ProFormSelect 在 showSearch + optionFilterProp="label" 启用时,会把 option.label
// 改写成 React element(用来高亮匹配的关键子串),直接 typeof === "string" 判断会拿到 React
// node 对象而不是原始字符串,导致 "一键复制" / 标题自动填充等下游逻辑拿不到客户名而静默失效。
//
// 解决:不依赖 option 形状,优先用 value 在外部维护的 id->name map 里查(主路径,最稳);
// 其次用 option 上预留的字符串备份字段(常见做法:在 request 返回时多加一个 name 字段);
// 最后才回退到 option.label 本身的 string 检查(不搜索时走这条)。
//
// 函数纯,无副作用,可在不引入 React 测试工具链的情况下做单元测试。
export function extractOptionLabel(
  value: unknown,
  option: unknown,
  nameById?: ReadonlyMap<string, string>
): string {
  if (value && typeof value === "string" && nameById) {
    const fromMap = nameById.get(value);
    if (fromMap) return fromMap;
  }
  if (option && typeof option === "object") {
    const o = option as { label?: unknown; name?: unknown; title?: unknown };
    if (typeof o.name === "string" && o.name.length > 0) return o.name;
    if (typeof o.title === "string" && o.title.length > 0) return o.title;
    if (typeof o.label === "string" && o.label.length > 0) return o.label;
  }
  return "";
}
