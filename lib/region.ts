// 客户区域 (省/市/区/镇街) 共享 helper: 级联树类型、路径拆分、展示拼接、Prisma where 构造。
// 合同/客户两端的区域筛选与展示统一走这里, 避免多处复制漂移 (此前同一 fetcher/拼接/where 各有 2-5 份拷贝)。

/** /api/divisions 返回的 label-keyed 级联树节点 (value === label === DB 里存的中文名) */
export type RegionNode = { value: string; label: string; children?: RegionNode[] };

/**
 * legacy-fineui.mjs 给无法映射 areaID 的老客户兜底写的区域值
 * (scripts/migrate/lib/sanitize.mjs UNKNOWN_REGION = { province: "未知", city: "未知" }).
 * 它不在行政区划树里, 级联 options 末尾追加这个节点, 让这批老数据可以被筛出并人工清理.
 */
export const UNKNOWN_REGION_NODE: RegionNode = { value: "未知", label: "未知" };

export type RegionParams = {
  province?: string;
  city?: string;
  district?: string;
  town?: string;
};

/** cascader 路径数组 (任意前缀, e.g. ["浙江省", "杭州市"]) → 4 个标量; 非数组/空路径全 undefined */
export function splitRegionPath(path: unknown): RegionParams {
  const arr = Array.isArray(path) ? (path as string[]) : [];
  return { province: arr[0], city: arr[1], district: arr[2], town: arr[3] };
}

/** 省/市/区/镇街拼接展示 (空层跳过); 全空返回 "", 回退文案 ("—" 或 "") 由调用方决定 */
export function formatRegion(
  province?: string | null,
  city?: string | null,
  district?: string | null,
  town?: string | null
): string {
  return [province, city, district, town].filter(Boolean).join(" / ");
}

export type RegionWhere = {
  province?: { equals: string; mode: "insensitive" };
  city?: { equals: string; mode: "insensitive" };
  district?: { equals: string; mode: "insensitive" };
  town?: { equals: string; mode: "insensitive" };
};

/**
 * 区域 where 构造: 任一非空层参与过滤, equals + insensitive (客户/合同两页统一口径).
 * 返回 undefined 表示无区域条件; 调用方:
 *   客户列表:  ...buildRegionWhere(params)
 *   合同列表:  ...(regionWhere ? { customer: regionWhere } : {})
 */
export function buildRegionWhere(filter: RegionParams): RegionWhere | undefined {
  const where: RegionWhere = {};
  if (filter.province) where.province = { equals: filter.province, mode: "insensitive" };
  if (filter.city) where.city = { equals: filter.city, mode: "insensitive" };
  if (filter.district) where.district = { equals: filter.district, mode: "insensitive" };
  if (filter.town) where.town = { equals: filter.town, mode: "insensitive" };
  return Object.keys(where).length > 0 ? where : undefined;
}
