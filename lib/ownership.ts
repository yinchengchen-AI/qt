// SALES 行级隔离统一封装。避免每个 service 重复手写 `user.roleCode === "SALES"`
// 的判断与 ownerUserId 注入。所有 list / get / create / update 的 where 都应消费这里。
//
// 注意:Prisma 7 的 WhereInput 是 per-model 的,且对关系字段有 Without<...> 约束,
// 泛型参数擦不掉这些签名。所以 helper 返回宽类型,由调用方在 spread 处 `as` 一下
// 对应 model 的 WhereInput;helper 自身只做 SALES 判断 + 对象构造。
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

/** SALES / EXPERT 均需行级数据隔离 (DESIGN-v3.md:183; init 迁移 RLS 策略同口径)。
 *  此前只判 SALES, 导致 EXPERT 零过滤可见/可改全公司数据, 已修复统一走此判断。
 *  此后仅统计/工作台/回收站口径使用; 业务浏览读路径不再消费。 */
export function isRowRestricted(user: SessionUser): boolean {
  return user.roleCode === "SALES" || user.roleCode === "EXPERT";
}

/** 直接挂在主表上的 ownerUserId 过滤(Customer / Contract)。
 *  此后仅统计/工作台/回收站口径使用; 业务浏览读路径不再消费。 */
export function ownerEq(user: SessionUser): { ownerUserId?: string } {
  return isRowRestricted(user) ? { ownerUserId: user.id } : {};
}

/** 跨一跳关系时的 ownerUserId 过滤(Invoice / Payment 等经由 contract)。
 *  此后仅统计/工作台/回收站口径使用; 业务浏览读路径不再消费。 */
export function ownerViaContract(user: SessionUser): { contract?: { ownerUserId: string } } {
  return isRowRestricted(user) ? { contract: { ownerUserId: user.id } } : {};
}

/** 写守门: 受限角色 (SALES/EXPERT) 只能写 owner 是自己的记录;
 *  写他人或无 owner 的记录抛 403。非受限角色 (ADMIN/FINANCE/OPS) 直接放行。
 *  what 为业务名词 ("客户" / "合同" / ...), 用于拼出可读报错。 */
export function assertRecordWritable(
  user: SessionUser,
  recordOwnerId: string | null | undefined,
  what: string
): void {
  if (isRowRestricted(user) && recordOwnerId !== user.id) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, `无权操作他人${what}`, 403);
  }
}

/** 解析逗号分隔的多状态;为空返回 undefined。 */
export function parseStatusList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}
