/**
 * 把文本写入剪贴板,跨环境/HTTP 兼容。
 * - 优先用 navigator.clipboard.writeText (HTTPS / localhost / secure context)
 * - 失败时回落到 document.execCommand('copy') (老 API, 但 HTTP 下仍可用)
 * - 都不行时返回 false (让 caller 决定 fallback: 保持 UI 可见让用户手动选 + Ctrl+C)
 *
 * 返回 boolean: true = 已写入剪贴板, false = 失败需 caller 给用户看文本
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1) 现代 API
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到下面
    }
  }
  // 2) execCommand fallback (HTTP 下 navigator.clipboard 会拒)
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}
