// 合同标题自动生成:由客户名 + 服务类型中文标签 + 年份派生。
// 纯函数,前后端都可复用;前端表单在客户/服务类型/签订日变化时调用。
//
// 格式:`{客户名}{年份}年{服务类型}合同`,例:`杭州阿里巴巴 2026年管理咨询合同`
// 年份:优先用调用方传入(从 form 的 signDate 提取);缺省则取当前年。

export function computeAutoTitle(
  customerName: string | null | undefined,
  serviceTypeLabel: string | null | undefined,
  year?: number | null
): string {
  const c = String(customerName ?? "").trim();
  const s = String(serviceTypeLabel ?? "").trim();
  if (!c || !s) return "";
  const y = year ?? new Date().getFullYear();
  return `${c}${y}年${s}合同`;
}
