"use client";
// /api/divisions 级联树的共享拉取 hook: 合同页/客户页的地区级联统一从这里取 options.
// (此前两页各有一份逐字复制的 fetcher, 且失败时 SWR 静默吞错, cascader 无声变空面板)
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { UNKNOWN_REGION_NODE, type RegionNode } from "@/lib/region";

export type RegionOptions = {
  regionOptions: RegionNode[];
  /** 拉取失败时非空; 页面应据此给出可见提示, 而不是让级联静默为空 */
  regionError: unknown;
};

export function useRegionOptions(): RegionOptions {
  const fetcher = useCallback(async (url: string): Promise<RegionNode[]> => {
    const res = await fetch(url, { credentials: "include" });
    const j = await res.json();
    if (j.code !== 0) throw new Error(j.message);
    return (j.data ?? []) as RegionNode[];
  }, []);
  const { data, error } = useSWR<RegionNode[]>("/api/divisions", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000
  });
  // 末尾追加"未知"节点: legacy 导入客户的区域兜底值不在行政区划树内, 使其可被筛出 (见 lib/region.ts)
  const regionOptions = useMemo(
    () => (data ? [...data, UNKNOWN_REGION_NODE] : []),
    [data]
  );
  return { regionOptions, regionError: error };
}
