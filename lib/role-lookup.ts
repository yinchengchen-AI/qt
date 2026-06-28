"use client";
// code -> 角色名 解析 hook,工作流任务 "期望执行角色" 字段只存 code,
// 详情页/卡片拿来做 code -> 中文名 展示
// - 用 SWR 拉一次 /api/roles?pageSize=100(覆盖所有内置 + 自定义角色)
// - module-level dedupe 自动复用缓存,跟 useUserLookup 模式一致
import useSWR from "swr";

export type LookupRole = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount?: number;
};

async function fetchRoles(url: string): Promise<{ list: LookupRole[] }> {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j?.code !== 0) return { list: [] };
  return (j.data ?? { list: [] }) as { list: LookupRole[] };
}

/** 全量 code->角色 映射;在多个详情页之间共享一次拉取 */
export function useRoleLookup(): Map<string, LookupRole> {
  const { data } = useSWR<{ list: LookupRole[] }>(
    "/api/roles?pageSize=100",
    fetchRoles,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000
    }
  );
  const map = new Map<string, LookupRole>();
  (data?.list ?? []).forEach((r) => map.set(r.code, r));
  return map;
}

/** code -> 中文名 映射(只取 name);用于下拉/Select options */
export function useRoleNameMap(): Record<string, string> {
  const lookup = useRoleLookup();
  const out: Record<string, string> = {};
  lookup.forEach((r, code) => {
    out[code] = r.name;
  });
  return out;
}

/** 单 code 解析成角色名,无值或查不到时回落到 code 本身 */
export function useRoleName(code: string | null | undefined, fallback?: string): string {
  const lookup = useRoleLookup();
  if (!code) return fallback ?? "";
  return lookup.get(code)?.name ?? fallback ?? code;
}
