"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";

type DictItem = { code: string; label: string };
const cache = new Map<string, DictItem[]>();
const subs = new Map<string, Set<() => void>>();

async function fetchDict(category: string): Promise<DictItem[]> {
  const res = await fetch(`/api/dictionaries?category=${encodeURIComponent(category)}`, {
    credentials: "include"
  });
  const j = await res.json();
  if (j.code !== 0) return [];
  return j.data as DictItem[];
}

async function loadDict(category: string): Promise<DictItem[]> {
  if (cache.has(category)) return cache.get(category)!;
  const data = await fetchDict(category);
  cache.set(category, data);
  return data;
}

function notify(category: string) {
  subs.get(category)?.forEach((fn) => fn());
}

export function useDict(category: string): DictItem[] {
  // 用 useState + useSWR 触发 fetch；初次返回 fallback，fetch 完成后通过 setState 触发重渲染
  const [data, setData] = useState<DictItem[]>(() => cache.get(category) ?? []);
  const { data: swrData } = useSWR(["dict", category], () => loadDict(category), {
    fallbackData: cache.get(category),
    revalidateOnMount: !cache.has(category)
  });
  useEffect(() => {
    if (swrData) {
      setData(swrData);
      cache.set(category, swrData);
    }
  }, [swrData, category]);
  if (!subs.has(category)) subs.set(category, new Set());
  return data;
}


export async function refreshDict(category: string) {
  cache.delete(category);
  await loadDict(category);
  notify(category);
}


/**
 * 字典分组 helper: 把 category 下的字典按 'LEGACY-' 前缀切成 system / legacy 两组
 * 用于 SERVICE_TYPE 这种有 22 个旧条目的场景
 *
 * 返回 antd Select 的 options 格式: [{ label: '系统服务类型', options: [...] }, { label: '历史服务类型 (FineUI)', options: [...] }]
 */
export function groupDictByLegacy(
  items: DictItem[],
  opts?: { systemLabel?: string; legacyLabel?: string }
): { label: string; options: DictItem[] }[] {
  const system = items.filter((d) => !d.code.startsWith('LEGACY-'));
  const legacy = items.filter((d) => d.code.startsWith('LEGACY-'));
  const out = [];
  if (system.length > 0) out.push({ label: opts?.systemLabel ?? '系统服务类型', options: system });
  if (legacy.length > 0) out.push({ label: opts?.legacyLabel ?? '历史服务类型 (FineUI 迁移)', options: legacy });
  return out;
}
