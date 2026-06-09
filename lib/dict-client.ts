"use client";
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
  const { mutate } = useSWR(["dict", category], () => loadDict(category), { fallbackData: cache.get(category) });
  if (!subs.has(category)) subs.set(category, new Set());
  return (cache.get(category) ?? mutate ?? []) as DictItem[];
}

export function useDicts(categories: string[]): Record<string, DictItem[]> {
  const out: Record<string, DictItem[]> = {};
  for (const c of categories) {
    out[c] = useDict(c);
  }
  return out;
}

export async function refreshDict(category: string) {
  cache.delete(category);
  await loadDict(category);
  notify(category);
}
