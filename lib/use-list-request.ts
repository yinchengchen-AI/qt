"use client";
import { useCallback, useEffect, useState } from "react";

export type ListParams = Record<string, unknown>;

export type ListRequestExtra = (params: ListParams) => Record<string, unknown> | undefined;

export type ListResult<T> = { data: T[]; total: number; success: true };

const KNOWN_KEYS = new Set([
  "keyword",
  "status",
  "scale",
  "customerId",
  "customerType",
  "serviceType",
  "contractId",
  "invoiceId"
]);

function buildQuery(params: ListParams, extra?: ListRequestExtra): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("page", String(params.current ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 20));
  for (const [k, v] of Object.entries(params)) {
    if (k === "current" || k === "pageSize") continue;
    if (v == null || v === "") continue;
    if (KNOWN_KEYS.has(k)) qs.set(k, String(v));
  }
  if (extra) {
    const e = extra(params);
    if (e) {
      for (const [k, v] of Object.entries(e)) {
        if (v == null || v === "") continue;
        qs.set(k, String(v));
      }
    }
  }
  return qs;
}

/** ProTable 的 request 回调:返回 { data, total, success }。  */
export function makeListRequest<T = unknown>(
  endpoint: string | ((params: ListParams) => string),
  extra?: ListRequestExtra
): (params: ListParams) => Promise<ListResult<T>> {
  return async (params) => {
    const url = typeof endpoint === "function" ? endpoint(params) : endpoint;
    const qs = buildQuery(params, extra);
    const res = await fetch(`${url}?${qs}`, { credentials: "include" });
    const j = await res.json();
    if (j.code !== 0) throw new Error(j.message);
    return {
      data: (j.data?.list ?? []) as T[],
      total: j.data?.total ?? 0,
      success: true
    };
  };
}

export type UseListRequestOptions = {
  /** 由参数生成额外查询字段;返回 undefined / 空对象表示不加 */
  extra?: ListRequestExtra;
  /** 初始 pageSize;默认 20 */
  pageSize?: number;
  /** 初始 page;默认 1 */
  page?: number;
  /** 依赖项;变化时自动重新拉取 */
  deps?: ReadonlyArray<unknown>;
};

/** 适合 useState 风格的列表页(announcements / operation-logs / aging 子表)使用。  */
export function useListRequest<T = unknown>(
  endpoint: string,
  options: UseListRequestOptions = {}
) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;

  const load = useCallback(
    async (p: number, ps: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = buildQuery({ current: p, pageSize: ps }, options.extra);
        const res = await fetch(`${endpoint}?${qs}`, { credentials: "include" });
        const j = await res.json();
        if (j.code !== 0) throw new Error(j.message);
        setData((j.data?.list ?? []) as T[]);
        setTotal(j.data?.total ?? 0);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, page, pageSize, ...(options.deps ?? [])]
  );

  useEffect(() => {
    void load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, total, loading, error, reload: () => load(page, pageSize) };
}
