// 登录限速 + 失败计数锁定
// 双层防护:
//   1) IP 维度 (in-memory): 防止单 IP 暴力穷举 (账号未知的攻击)
//   2) 用户维度 (DB 持久化): 防止针对已知账号的多 IP 散弹 (走 User.lockedUntil)
// 设计取舍:
//   - IP 限速用进程内 Map;Next.js dev 多 worker / PM2 cluster / k8s 多 pod 下每实例独立,
//     但单实例足够阻挡 99% 暴力穷举;DB 层是兜底
//   - 用户维度锁定走 DB, 多实例可见, 重新登录时拉 User 字段判断, 不依赖缓存
//   - 失败计数有衰减: 距上次失败 > FAIL_DECAY_MIN 视为新一轮
import { prisma } from "./prisma";

export const LOGIN_POLICY = {
  // IP 维度: 5 分钟窗口内最多 20 次失败 (单 IP, 不区分账号)
  IP_WINDOW_MS: 5 * 60 * 1000,
  IP_MAX_FAILS: 20,
  // 用户维度: 连续 5 次失败锁 15 分钟; 第 6 次起直接锁 60 分钟 (递增)
  USER_FAILS_BEFORE_LOCK: 5,
  USER_LOCK_MS: 15 * 60 * 1000,
  USER_LOCK_MS_HEAVY: 60 * 60 * 1000,
  // 衰减窗口: 上次失败 > 该时长, 计数归零 (允许 "输错几次后冷静一会")
  FAIL_DECAY_MS: 30 * 60 * 1000,
} as const;

type IpBucket = { fails: number[]; expiresAt: number };
const ipBuckets = new Map<string, IpBucket>();

function gcIp(now: number) {
  if (ipBuckets.size < 500) return;
  for (const [k, v] of ipBuckets) {
    if (v.expiresAt <= now) ipBuckets.delete(k);
  }
}

/** 取出当前 IP 窗口内的失败次数 (本函数不写入) */
export function countIpFails(ip: string, now = Date.now()): number {
  const b = ipBuckets.get(ip);
  if (!b) return 0;
  const cutoff = now - LOGIN_POLICY.IP_WINDOW_MS;
  return b.fails.filter((t) => t > cutoff).length;
}

/** 判断 IP 是否被限速 */
export function isIpRateLimited(ip: string, now = Date.now()): boolean {
  return countIpFails(ip, now) >= LOGIN_POLICY.IP_MAX_FAILS;
}

/** 记录一次 IP 失败 */
export function recordIpFail(ip: string, now = Date.now()): void {
  const cutoff = now - LOGIN_POLICY.IP_WINDOW_MS;
  const existing = ipBuckets.get(ip);
  const fails = existing ? existing.fails.filter((t) => t > cutoff) : [];
  fails.push(now);
  ipBuckets.set(ip, { fails, expiresAt: now + LOGIN_POLICY.IP_WINDOW_MS });
  gcIp(now);
}

/** 登录成功清掉该 IP 的失败记录 */
export function clearIpFails(ip: string): void {
  ipBuckets.delete(ip);
}

// ---- 用户维度 (DB 持久化) ----

export type UserLockState = {
  locked: boolean;
  lockedUntil: Date | null;
  failedCount: number;
};

/** 读取用户当前锁定状态; 锁定已过期视为未锁 */
export async function getUserLockState(employeeNo: string, now = new Date()): Promise<UserLockState | null> {
  const u = await prisma.user.findFirst({
    where: { employeeNo, deletedAt: null, isSystem: false },
    select: { failedLoginCount: true, lockedUntil: true }
  });
  if (!u) return null;
  const locked = u.lockedUntil ? u.lockedUntil > now : false;
  return {
    locked,
    lockedUntil: locked ? u.lockedUntil : null,
    failedCount: u.failedLoginCount
  };
}

/**
 * 记录一次失败并返回新状态 (含是否被锁)
 * 衰减: 距上次失败 > FAIL_DECAY_MS 则计数归零再 +1
 */
export async function recordUserFail(employeeNo: string, now = new Date()): Promise<UserLockState> {
  const u = await prisma.user.findFirst({
    where: { employeeNo, deletedAt: null, isSystem: false },
    select: { id: true, failedLoginCount: true, lastFailedLoginAt: true }
  });
  if (!u) return { locked: false, lockedUntil: null, failedCount: 0 };

  const decayed =
    !u.lastFailedLoginAt ||
    now.getTime() - u.lastFailedLoginAt.getTime() > LOGIN_POLICY.FAIL_DECAY_MS;
  const nextCount = (decayed ? 0 : u.failedLoginCount) + 1;

  let lockedUntil: Date | null = null;
  if (nextCount >= LOGIN_POLICY.USER_FAILS_BEFORE_LOCK + 1) {
    lockedUntil = new Date(now.getTime() + LOGIN_POLICY.USER_LOCK_MS_HEAVY);
  } else if (nextCount >= LOGIN_POLICY.USER_FAILS_BEFORE_LOCK) {
    lockedUntil = new Date(now.getTime() + LOGIN_POLICY.USER_LOCK_MS);
  }

  await prisma.user.update({
    where: { id: u.id },
    data: { failedLoginCount: nextCount, lastFailedLoginAt: now, lockedUntil }
  });
  return { locked: lockedUntil !== null, lockedUntil, failedCount: nextCount };
}

/** 登录成功: 清掉失败计数和锁定 */
export async function clearUserFails(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null }
  });
}
