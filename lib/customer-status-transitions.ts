// 客户状态机: 5 个状态之间的合法迁移表
//
// 设计要点:
//   1. 这是状态机迁移的「单一事实源」, Service 与 UI 都消费这里, 避免规则散落。
//   2. LEAD→FROZEN 暂不允许: FROZEN 通常是合规/欠款场景, 不符合「线索」语义;
//      如业务侧确实需要, 后续单开 PR 加边并补单测。
//   3. LOST/FROZEN 自循环不在表内, 出现即非法。
//   4. 同状态写入 (NEGOTIATING→NEGOTIATING) 也视为非法, 避免 noop 写入绕过审计。
//
// 调用方:
//   - server/services/customer.ts 内的 changeCustomerStatus 在事务里先 assertCanTransition
//   - app/(app)/customers/[id]/edit/page.tsx 根据 currentStatus 过滤下拉项
//   - 详情页 Popover 显示当前可去的下一个状态
//   - 自动联动 job 不会直接写状态, 但会在提示里指明目标状态, 让用户走手动确认路径
//
// 本文件是客户端安全的, 不依赖 next/server, 可被 Server/Client Component 同时引用。
// 服务端抛错版本 (assertCanTransition) 单独放在 server/services/customer-status.ts 里。
import { CUSTOMER_STATUS, type CustomerStatus } from "@/types/enums";

/** 状态机迁移表: 起点状态 -> 允许去往的目标状态集合 */
export const CUSTOMER_STATUS_TRANSITIONS: Record<CustomerStatus, CustomerStatus[]> = {
  LEAD: ["NEGOTIATING", "SIGNED", "LOST"],
  NEGOTIATING: ["SIGNED", "LOST", "FROZEN"],
  SIGNED: ["LOST", "FROZEN"],
  LOST: ["NEGOTIATING"],
  FROZEN: ["NEGOTIATING"]
};

/** 给定当前状态返回所有允许的目标状态 (供 UI 渲染下拉项) */
export function getAllowedTransitions(from: CustomerStatus): CustomerStatus[] {
  return CUSTOMER_STATUS_TRANSITIONS[from] ?? [];
}

/** 给定当前状态返回「不允许去往」的状态集合, 供 UI 在校验失败时给出错误码 */
export function getDisallowedTransitions(from: CustomerStatus): CustomerStatus[] {
  return CUSTOMER_STATUS.filter((s) => !CUSTOMER_STATUS_TRANSITIONS[from].includes(s));
}

/** 是否为合法的 customer status 字符串 (包含未注册的状态码, 例如 'BOGUS') */
export function isCustomerStatus(value: unknown): value is CustomerStatus {
  return typeof value === "string" && (CUSTOMER_STATUS as readonly string[]).includes(value);
}
