// KNOWN_KEYS 自动推导工具。反射 zod schema 的 shape, 不再手维护白名单。
// 替换 use-list-request.ts:KNOWN_KEYS 14 项手维护集合。
//
// 用法: 把所有 listQuerySchema 喂给 deriveKnownKeys, 反射出所有允许的字段
// (并集, 自动跳过 page / pageSize — 这两个由 use-list-request 内置处理)。
//
// 加新筛选维度时, 只需在对应 listQuerySchema 加字段, use-list-request 自动跟着走,
// 不再需要手动改 lib/use-list-request.ts:KNOWN_KEYS + 同步 tests/lib/use-list-request.test.ts.
import type { ZodObject } from "zod";

/**
 * 从多个 zod schema 反射出 list query 的允许字段集合 (并集)。
 * 自动跳过 page / pageSize (由 use-list-request 内置)。
 */
export function deriveKnownKeys(schemas: ZodObject[]): Set<string> {
  const out = new Set<string>();
  for (const s of schemas) {
    // zod 4 中 z.object({...}).shape 直接返回字段 map, 无需任何反射库
    const shape = (s as unknown as { shape: Record<string, unknown> }).shape;
    if (!shape) continue;
    for (const k of Object.keys(shape)) {
      if (k === "page" || k === "pageSize") continue;
      out.add(k);
    }
  }
  return out;
}
