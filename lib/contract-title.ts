// 合同标题自动生成:由年份 + 服务类型中文标签派生。
// 纯函数,前后端都可复用;前端表单在客户/服务类型/签订日变化时调用。
//
// 格式:`{年份}年{服务类型}合同`,例:`2026年管理咨询合同`
// 不再拼客户名:客户名在列表的「客户」列 / 详情的 Descriptions「客户」字段已经独立展示,
// 拼进标题会与客户信息重复。
// 年份:优先用调用方传入(从 form 的 signDate 提取);缺省则取当前年。
//
// customerName 参数为兼容历史调用方保留;函数体内已不再使用,新调用可不传。

export function computeAutoTitle(
  // customerName 保留为兼容历史调用方的占位参数;函数体内不再使用,新调用可不传
  customerName: string | null | undefined,
  serviceTypeLabel: string | null | undefined,
  year?: number | null
): string {
  const s = (serviceTypeLabel ?? "").trim();
  if (!s) return "";
  const y = year ?? new Date().getFullYear();
  return `${y}年${s}合同`;
}
