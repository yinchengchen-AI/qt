import type { ApiErr, ApiOk } from "@/lib/api";

export async function fetchApiData<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (res.ok && body.code === 0 && "data" in body) return body.data;
  throw new Error(body.message || `请求失败 (${res.status})`);
}
