// 项目名称自动生成:由所选合同的客户名 + 服务类型中文标签派生。
// 纯函数, 前后端都可复用; 前端表单在合同变化时调用。
//
// 格式: `{客户名} - {服务类型}项目`, 例: `杭州军途重卡汽车服务有限公司 - 隐患排查项目`
// - 客户名 / 服务类型任一为空 → 返空串 (前端不覆盖)
// - 全部入参做 toSafeName 防御: 数字 / null / undefined / 对象一律降级为空, 避免 .trim() 抛错
//   或把数字当客户名拼到名称里
export function computeProjectTitle(input: {
  customerName?: string | null | undefined;
  serviceTypeLabel?: string | null | undefined;
  // 合同号可选, 当前实现没拼到名字里 (避免客户名 + 合同号双重冗余), 但留接口给后续扩展
  contractNo?: string | null | undefined;
}): string {
  const c = toSafeName(input.customerName);
  const s = toSafeName(input.serviceTypeLabel);
  if (!c || !s) return "";
  return `${c} - ${s}项目`;
}

// 跟 lib/contract-title.ts 里的 toSafeName 同源, 抽到这里方便项目端独立 import
// (避免把 contract-title 的 contract 防御细节拽进 project 表单). 行为完全一致.
export function toSafeName(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}
