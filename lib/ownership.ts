// SALES 行级隔离统一封装。避免每个 service 重复手写 `user.roleCode === "SALES"`
// 的判断与 ownerUserId 注入。所有 list / get / create / update 的 where 都应消费这里。
//
// 注意:Prisma 7 的 WhereInput 是 per-model 的,且对关系字段有 Without<...> 约束,
// 泛型参数擦不掉这些签名。所以 helper 返回宽类型,由调用方在 spread 处 `as` 一下
// 对应 model 的 WhereInput;helper 自身只做 SALES 判断 + 对象构造。
import type { SessionUser } from "@/lib/session";

/** 直接挂在主表上的 ownerUserId 过滤(Customer / Contract)。 */
export function ownerEq(user: SessionUser): { ownerUserId?: string } {
  return user.roleCode === "SALES" ? { ownerUserId: user.id } : {};
}

/** 跨一跳关系时的 ownerUserId 过滤(Project / Invoice / Payment 等经由 contract)。*/
export function ownerViaContract(user: SessionUser): { contract?: { ownerUserId: string } } {
  return user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {};
}

/** 解析逗号分隔的多状态;为空返回 undefined。 */
export function parseStatusList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}
