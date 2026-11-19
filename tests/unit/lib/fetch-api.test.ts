import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchApiData } from "@/lib/fetch-api";

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchApiData", () => {
  it("code=0 时返回 data，并携带当前登录凭证", async () => {
    const fetchMock = mockFetchOnce(200, { code: 0, data: { total: 12 } });

    await expect(fetchApiData<{ total: number }>("/api/example")).resolves.toEqual({ total: 12 });
    expect(fetchMock).toHaveBeenCalledWith("/api/example", { credentials: "include" });
  });

  it("业务 code 非零时 reject，并保留服务端 message", async () => {
    mockFetchOnce(200, { code: 403, errorCode: "FORBIDDEN", message: "没有查看权限" });

    await expect(fetchApiData("/api/example")).rejects.toThrow("没有查看权限");
  });

  it("HTTP 500 时 reject，并保留服务端 message", async () => {
    mockFetchOnce(500, { code: 500, errorCode: "INTERNAL_ERROR", message: "汇总服务暂不可用" });

    await expect(fetchApiData("/api/example")).rejects.toThrow("汇总服务暂不可用");
  });

  it("响应不是有效 JSON 时 reject", async () => {
    mockFetchOnce(200, "not-json");

    await expect(fetchApiData("/api/example")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("网络请求 reject 时保留原始错误", async () => {
    const networkError = new Error("网络连接中断");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(fetchApiData("/api/example")).rejects.toBe(networkError);
  });
});
