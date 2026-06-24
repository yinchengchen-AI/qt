/**
 * 表单草稿 — localStorage 包装
 *
 * 设计:
 *  - 写入存 { value, savedAt } (ISO timestamp); 读出用 savedAt 提示 "上次未保存: 2 分钟前"
 *  - 仅在浏览器侧可用 (typeof window 检查); SSR 阶段全 null
 *  - 解析失败 (手动改坏 / quota 异常) 一律返回 null, 不抛错
 *  - 同一 key 同时只存一份; 命名建议: 'xxx-form-draft:create' / 'xxx-form-draft:edit-{id}'
 *
 * 用法:
 *   const meta = loadDraft<MyForm>(key);
 *   if (meta) { showRestorePrompt(meta.savedAt) }
 *   const stop = useDebouncedEffect(() => saveDraft(key, values), [values], 600);
 *   const onSubmit = async () => { ...; clearDraft(key); };
 */
export type DraftEnvelope<T> = {
  value: T;
  /** ISO 8601, 写入瞬间 */
  savedAt: string;
};

const NS = "qt-draft:";

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Safari 隐私模式 / 第三方 cookie 禁用时 localStorage 可能抛 SecurityError
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): boolean {
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    const env: DraftEnvelope<T> = { value, savedAt: new Date().toISOString() };
    ls.setItem(NS + key, JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft<T>(key: string): DraftEnvelope<T> | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(NS + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || !("value" in parsed) || !("savedAt" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): boolean {
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    ls.removeItem(NS + key);
    return true;
  } catch {
    return false;
  }
}

export function hasDraft(key: string): boolean {
  return loadDraft(key) !== null;
}

/**
 * 把 savedAt (ISO) 渲染为 "刚刚 / N 秒前 / N 分钟前 / N 小时前 / N 天前"
 * 给 "草稿已自动保存 · 2 分钟前" 这类提示用
 */
export function formatRelativeTime(savedAt: string, now: Date = new Date()): string {
  const t = new Date(savedAt).getTime();
  if (Number.isNaN(t)) return "未知时间";
  const diffSec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (diffSec < 5) return "刚刚";
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  // 长于一个月直接显示日期
  const d = new Date(savedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
