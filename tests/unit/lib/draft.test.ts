import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadDraft, saveDraft, clearDraft, hasDraft, formatRelativeTime } from "@/lib/draft";

/**
 * Node 环境下没有 window; 用 vi.stubGlobal 模拟 localStorage.
 * SSR 测试 (无 window) 也走 no-window 路径, 验证函数不抛错.
 */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
  vi.stubGlobal("window", { localStorage } as unknown as Window & typeof globalThis);
  return store;
}

describe("lib/draft (localStorage wrapper)", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveDraft + loadDraft 往返", () => {
    expect(saveDraft("k1", { name: "x", tags: ["a"] })).toBe(true);
    const env = loadDraft<{ name: string; tags: string[] }>("k1");
    expect(env).not.toBeNull();
    expect(env?.value).toEqual({ name: "x", tags: ["a"] });
    expect(typeof env?.savedAt).toBe("string");
    expect(Date.now() - new Date(env!.savedAt).getTime()).toBeLessThan(5000);
  });

  it("loadDraft 不存在的 key 返回 null", () => {
    expect(loadDraft("missing")).toBeNull();
  });

  it("clearDraft 后 loadDraft 返回 null", () => {
    saveDraft("k1", { x: 1 });
    expect(hasDraft("k1")).toBe(true);
    clearDraft("k1");
    expect(hasDraft("k1")).toBe(false);
    expect(loadDraft("k1")).toBeNull();
  });

  it("损坏的 JSON 不抛错, 返回 null", () => {
    store.set("qt-draft:bad", "{ not valid json");
    expect(loadDraft("bad")).toBeNull();
  });

  it("value / savedAt 缺一不可", () => {
    store.set("qt-draft:no-savedAt", JSON.stringify({ value: 1 }));
    expect(loadDraft("no-savedAt")).toBeNull();
  });

  it("saveDraft 写带正确 ns 前缀", () => {
    saveDraft("mykey", 42);
    expect(store.has("qt-draft:mykey")).toBe(true);
  });

  it("formatRelativeTime 边界", () => {
    const now = new Date("2026-06-24T12:00:00Z");
    expect(formatRelativeTime(new Date(now.getTime() - 2000).toISOString(), now)).toBe("刚刚");
    expect(formatRelativeTime(new Date(now.getTime() - 30000).toISOString(), now)).toBe("30 秒前");
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe("5 分钟前");
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe("3 小时前");
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now)).toBe("2 天前");
    expect(formatRelativeTime("not a date", now)).toBe("未知时间");
  });
});

describe("lib/draft SSR fallback (no window)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    // 显式确保没有 window
    delete (globalThis as { window?: unknown }).window;
  });

  it("saveDraft 返回 false", () => {
    expect(saveDraft("k", 1)).toBe(false);
  });
  it("loadDraft 返回 null", () => {
    expect(loadDraft("k")).toBeNull();
  });
  it("hasDraft 返回 false", () => {
    expect(hasDraft("k")).toBe(false);
  });
  it("clearDraft 返回 false", () => {
    expect(clearDraft("k")).toBe(false);
  });
  it("formatRelativeTime 仍能工作 (纯函数, 不依赖 window)", () => {
    expect(formatRelativeTime("2026-06-20T12:00:00Z", new Date("2026-06-24T12:00:00Z"))).toBe("4 天前");
  });
});
