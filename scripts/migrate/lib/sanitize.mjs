// 数据清洗/转换工具

const round2 = (v) => Math.round(v * 100) / 100;

/** 计算含税金额反算税额/不含税 (税率为 0.06 视为价内) */
export function calcInvoiceTax(amount, taxRate = 0.06) {
  const taxAmount = round2((amount * taxRate) / (1 + taxRate));
  const amountExcludingTax = round2(amount - taxAmount);
  return { taxAmount, amountExcludingTax };
}

/** 把 Date 或字符串统一成 Date（容忍 ISO/datetime 串） */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}

/** 日期差（毫秒） */
export function diffMs(a, b) {
  return Math.abs(toDate(a).getTime() - toDate(b).getTime());
}

/** 把任意 URL 字符串拆成 attachment JSON 快照（用于 Contract/Invoice.attachments） */
export function urlToAttachmentJson(url) {
  if (!url) return [];
  const cleaned = String(url).trim();
  if (!cleaned) return [];
  const basename = cleaned.split("/").pop() || "legacy-file";
  return [
    {
      id: `legacy-${cleaned.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`,
      name: basename,
      url: cleaned,
      mimeType: "application/octet-stream",
      size: 0,
      uploadedBy: "legacy",
      uploadedAt: new Date().toISOString()
    }
  ];
}

/** 合同号是否 "合法可保留"：HZ+字母+数字 且非短占位 */
export function isKeepableContractNo(raw) {
  if (!raw) return false;
  const s = String(raw).trim();
  if (s.length === 0) return false;
  // 短占位（1-3 字符）一律视为垃圾
  if (s.length <= 3) return false;
  // 合法 HZ+字母+数字 模式 (如 HZQT2026030, HZCY2026009)
  if (/^HZ[A-Z]+[0-9]+$/.test(s)) return true;
  // 其他非空字符串暂作"保留"（写报告让人工核对）
  return true;
}

/** 合同号去重：返回一个 copy 数组，重复项加 -DUP{n} 后缀；firstWrite 记录原始值是否首次出现 */
export function dedupContractNos(contractNos) {
  const seen = new Map();
  return contractNos.map((raw) => {
    if (!isKeepableContractNo(raw)) return { kept: false, original: raw, deduped: null };
    const s = String(raw).trim();
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    if (n === 1) return { kept: true, original: raw, deduped: s, dup: false };
    return { kept: true, original: raw, deduped: `${s}-DUP${n - 1}`, dup: true };
  });
}

/** 客户重名去重：同 name 出现第二次起加 " (LEGACY-{oldId})" 后缀 */
export function dedupCustomerNames(rows) {
  const seen = new Map();
  return rows.map((r) => {
    const name = (r.Name ?? "").trim();
    if (!name) return { ...r, _name: "(未命名)", _dup: false };
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n === 1) return { ...r, _name: name, _dup: false };
    return { ...r, _name: `${name} (LEGACY-${r.ID})`, _dup: true };
  });
}

/** areas 26 行 → 26 个 Dictionary code（顶级 `R{ID}`, 子级 `R{parent}.{ID}`） */
export function areaToCode(areaId, parentId) {
  if (parentId == null) return `R${areaId}`;
  return `R${parentId}.${areaId}`;
}

/** 给 7 个未知 areaID 的 customer 提供兜底 */
export const UNKNOWN_REGION = { province: "未知", city: "未知" };
