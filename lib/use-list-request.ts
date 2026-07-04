"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { customerListQuerySchema } from "@/lib/validators/customer";
import { contractListQuerySchema } from "@/lib/validators/contract";
import { invoiceListQuerySchema } from "@/lib/validators/invoice";
import { paymentListQuerySchema } from "@/lib/validators/payment";
import { userListQuerySchema } from "@/lib/validators/user";
import { deriveKnownKeys } from "@/lib/known-keys";

export type ListParams = Record<string, unknown>;

export type ListRequestExtra = (params: ListParams) => Record<string, unknown> | undefined;

export type ListResult<T> = { data: T[]; total: number; success: true };

// 服务端 list 路由支持的标准过滤键;前端 ProTable 把这些键透传到 query。
// 通过 deriveKnownKeys 从 5 个 listQuerySchema 反射得到, 不再手维护。
// 加新筛选维度时:
//   (1) 改对应 list 路由的 zod schema (会自动反映到 KNOWN_KEYS)
//   (2) 确认对应 service 都接受它
//   (3) tests/lib/use-list-request.test.ts 会自动覆盖 (因为它直接用 KNOWN_KEYS 测)
export const KNOWN_KEYS = deriveKnownKeys([
  customerListQuerySchema,
  contractListQuerySchema,
  invoiceListQuerySchema,
  paymentListQuerySchema,
  userListQuerySchema,
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
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (p: number, ps: number) => {
      const id = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const qs = buildQuery({ current: p, pageSize: ps }, options.extra);
        const res = await fetch(`${endpoint}?${qs}`, { credentials: "include" });
        const j = await res.json();
        if (id !== requestIdRef.current) return;
        if (j.code !== 0) throw new Error(j.message);
        setData((j.data?.list ?? []) as T[]);
        setTotal(j.data?.total ?? 0);
      } catch (e) {
        if (id !== requestIdRef.current) return;
        setError((e as Error).message);
      } finally {
        if (id === requestIdRef.current) {
          setLoading(false);
        }
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
