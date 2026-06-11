"use client";
// id → 用户名 解析 hook,详情页里"登记人/对账人/操作人"等只存 id 的列拿来转中文
// - 用 SWR 拉一次 /api/users?pageSize=100(覆盖全员),module-level dedupe 自动复用缓存
// - 大数据量场景(>5000 人)再考虑分页或按需 /api/users/{id},目前 100 条够用
import useSWR from "swr";

export type LookupUser = {
  id: string;
  employeeNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

async function fetchUsers(url: string): Promise<LookupUser[]> {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) return [];
  return (j.data?.list ?? []) as LookupUser[];
}

/** 全员 id→用户 映射;在多个详情页之间共享一次拉取 */
export function useUserLookup(): Map<string, LookupUser> {
  const { data } = useSWR<LookupUser[]>("/api/users?pageSize=100", fetchUsers, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000
  });
  const map = new Map<string, LookupUser>();
  (data ?? []).forEach((u) => map.set(u.id, u));
  return map;
}

/** 单 id 解析成姓名,无值或查不到时回落到 "—" 或原 id */
export function useUserName(id: string | null | undefined, fallback = "—"): string {
  const map = useUserLookup();
  if (!id) return fallback;
  return map.get(id)?.name ?? id;
}
