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
