// 客户状态机: 服务端校验 (抛 ApiError 版本)
//
// 客户端安全版本 (纯数据 + 纯函数) 在 lib/customer-status-transitions.ts, 这里只放
// 需要抛 ApiError 的服务端入口, 避免 lib/api.ts 的 next/server 依赖被拉到客户端 bundle.
//
// 设计:
//   - from / to 都接 string, 内部用 isCustomerStatus 做白名单校验, 调用方无需 cast
//   - 同状态写入 (NEGOTIATING->NEGOTIATING) 算非法, 防止 noop 写入绕过审计
//   - 非法目标字符串 (例如 'BOGUS') 一律视为非法迁移
//   - 抛 ApiError(CUSTOMER_STATUS_TRANSITION_INVALID, 422), 与其他业务错误同形
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { CUSTOMER_STATUS_TRANSITIONS, isCustomerStatus } from "@/lib/customer-status-transitions";

/** 校验 from -> to 是否合法; 非法抛 ApiError(CUSTOMER_STATUS_TRANSITION_INVALID, 422) */
export function assertCanTransition(from: string, to: string): void {
  if (!isCustomerStatus(from)) {
    // from 来自 DB 中 customer.status, 理论上一定是合法枚举, 这里防御性兜底
    throw new ApiError(
      ERROR_CODES.INTERNAL_ERROR,
      `客户状态起点非法: ${from}`,
      500
    );
  }
  if (!isCustomerStatus(to)) {
    throw new ApiError(
      ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
      `客户状态 ${from} → ${to} 不允许`,
      422,
      { from, to, allowed: CUSTOMER_STATUS_TRANSITIONS[from] }
    );
  }
  const allowed = CUSTOMER_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ApiError(
      ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
      `客户状态 ${from} → ${to} 不允许`,
      422,
      { from, to, allowed }
    );
  }
}
