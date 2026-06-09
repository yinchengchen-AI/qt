// RLS 兜底：在 Prisma 事务开始时设置 app.user_id / app.user_role
// 设计文档 §3 兜底策略：
//   应用层事务开始前 SET LOCAL app.user_id = ${session.userId};
//                     SET LOCAL app.user_role = ${session.roleCode};
//   PG 层 RLS 策略 USING (current_setting('app.user_role', true) = 'SALES'
//                         AND ownerUserId = current_setting('app.user_id', true))
//
// 注意：Prisma 7 + @prisma/adapter-pg 的事务 API：
//   prisma.$transaction(async (tx) => { ... })
// 在 callback 中调用 tx.$executeRawUnsafe 即可设 GUC

import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";

type TxOrClient = Prisma.TransactionClient | PrismaClient;

/**
 * 在事务内为 SALES / 其它角色设置 RLS 上下文
 * 必须在所有 read/write 之前调用
 */
export async function applyRlsContext(tx: TxOrClient, user: SessionUser): Promise<void> {
  // set_config(name, value, is_local=true) 比 SET LOCAL 灵活（带默认值）
  // 第 3 个参数 true 表示只在当前事务内生效
  const safeId = user.id.replace(/'/g, "''");
  const safeRole = user.roleCode.replace(/'/g, "''");
  await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${safeId}', true)`);
  await tx.$executeRawUnsafe(`SELECT set_config('app.user_role', '${safeRole}', true)`);
  // 显式置空 bypass_rls
  await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'off', true)`);
}

/**
 * 用于 cron / 内部调用，绕过 RLS
 */
export async function bypassRlsContext(tx: TxOrClient): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true)`);
  await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '', true)`);
  await tx.$executeRawUnsafe(`SELECT set_config('app.user_role', '', true)`);
}

/**
 * 包装一个事务，自动套用 RLS 上下文
 */
export async function rlsTransaction<T>(
  prisma: PrismaClient,
  user: SessionUser,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, user);
    return fn(tx);
  });
}
