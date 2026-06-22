// 字典域元数据: 按"业务域"分组, 标记每个类目的 UI 形态 / 是否只读 / 中文标签
// 与 lib/dictionary-categories.ts 互补:
//   - dictionary-categories.ts: 16 类白名单 + 中文 label (service 校验用)
//   - dict-domain.ts: 类目按域分组 + UI 形态 + 只读护栏 (前端展示用)

export type DictShape = "table" | "tree";

/** 是否只读: true = 系统字典, UI 中禁编辑, 仅同步脚本改 */
export type DictReadonlyMode = boolean;

export type DictDomainMeta = {
  /** 类目 code; 业务类用 DictionaryCategory, 系统类用 string (如 "REGION") */
  category: string;
  /** 简短中文 label (优先用 DICTIONARY_CATEGORY_LABEL, 兜底用 category 本身) */
  label: string;
  /** UI 形态: table (平铺) / tree (树形) */
  shape: DictShape;
  /** 系统字典, UI 不可改; 同步脚本管理 */
  readonly: DictReadonlyMode;
  /** 简短说明, 鼠标悬停时显示 */
  description?: string;
  /** 条目数 (从 API 拿, 这里只存 cache) */
  count?: number;
};

/** 业务域分组顺序 */
export const DICT_DOMAINS = [
  "客户域",
  "业务域",
  "财务域",
  "状态域",
  "区域域"
] as const;

export type DictDomain = (typeof DICT_DOMAINS)[number];

/** 所有类目详细元数据 (16 类业务 + 1 类系统) */
export const DICT_META: Record<string, DictDomainMeta> = {
  // 客户域
  CUSTOMER_TYPE: { category: "CUSTOMER_TYPE", label: "客户类型", shape: "table", readonly: false, description: "客户的法律主体类型, 如企业/政府/其他" },
  CUSTOMER_SCALE: { category: "CUSTOMER_SCALE", label: "客户规模", shape: "table", readonly: false, description: "按规模分类, 用于报表和合同模板选择" },
  CUSTOMER_INDUSTRY: { category: "CUSTOMER_INDUSTRY", label: "客户行业", shape: "table", readonly: false, description: "客户所属行业, 用于行业分析和销售跟进" },
  CUSTOMER_SOURCE: { category: "CUSTOMER_SOURCE", label: "客户来源", shape: "table", readonly: false, description: "客户获取渠道, 用于营销 ROI 分析" },
  // 业务域
  SERVICE_TYPE: { category: "SERVICE_TYPE", label: "服务类型", shape: "table", readonly: false, description: "公司可提供的服务类型, 合同/项目主数据" },
  FOLLOW_METHOD: { category: "FOLLOW_METHOD", label: "跟进方式", shape: "table", readonly: false, description: "客户跟进时使用的沟通方式" },
  FOLLOW_RESULT: { category: "FOLLOW_RESULT", label: "跟进结果", shape: "table", readonly: false, description: "跟进结果分类, 推进销售漏斗" },
  // 财务域
  CONTRACT_PAYMENT_METHOD: { category: "CONTRACT_PAYMENT_METHOD", label: "合同付款方式", shape: "table", readonly: false, description: "合同付款方式: 一次性/按阶段/按月/按季" },
  INVOICE_TYPE: { category: "INVOICE_TYPE", label: "发票类型", shape: "table", readonly: false, description: "发票种类, 影响税务处理" },
  PAYMENT_RECEIVE_METHOD: { category: "PAYMENT_RECEIVE_METHOD", label: "收款方式", shape: "table", readonly: false, description: "回款收取方式" },
  REVIEW_ACTION: { category: "REVIEW_ACTION", label: "审批动作", shape: "table", readonly: false, description: "工作流审批动作" },
  // 状态域
  CUSTOMER_STATUS: { category: "CUSTOMER_STATUS", label: "客户状态", shape: "table", readonly: false, description: "客户状态机: 线索/谈判/签约/流失/冻结" },
  CONTRACT_STATUS: { category: "CONTRACT_STATUS", label: "合同状态", shape: "table", readonly: false, description: "合同状态机: 草稿/生效中/已完结" },
  INVOICE_STATUS: { category: "INVOICE_STATUS", label: "开票状态", shape: "table", readonly: false, description: "开票状态机" },
  PAYMENT_STATUS: { category: "PAYMENT_STATUS", label: "回款状态", shape: "table", readonly: false, description: "回款状态机" },
  // 区域域 (系统, 不在 16 类白名单, 由同步脚本管理)
  REGION: { category: "REGION", label: "行政区域", shape: "tree", readonly: true, description: "系统字典, 由 legacy 迁移脚本管理, UI 仅查看" }
};

/** 类目 -> 所属域 */
const CATEGORY_DOMAIN_MAP: Record<string, DictDomain> = {
  CUSTOMER_TYPE: "客户域",
  CUSTOMER_SCALE: "客户域",
  CUSTOMER_INDUSTRY: "客户域",
  CUSTOMER_SOURCE: "客户域",
  SERVICE_TYPE: "业务域",
  FOLLOW_METHOD: "业务域",
  FOLLOW_RESULT: "业务域",
  CONTRACT_PAYMENT_METHOD: "财务域",
  INVOICE_TYPE: "财务域",
  PAYMENT_RECEIVE_METHOD: "财务域",
  REVIEW_ACTION: "财务域",
  CUSTOMER_STATUS: "状态域",
  CONTRACT_STATUS: "状态域",
  INVOICE_STATUS: "状态域",
  PAYMENT_STATUS: "状态域",

  REGION: "区域域"
};

/** 给定域返回该域下所有类目, 按 DICT_META 声明顺序 */
export function categoriesInDomain(domain: DictDomain): string[] {
  return Object.keys(DICT_META).filter((c) => CATEGORY_DOMAIN_MAP[c] === domain);
}

/** 给定类目返回域 */
export function domainOf(category: string): DictDomain {
  return CATEGORY_DOMAIN_MAP[category] ?? "客户域";
}

/** 业务类 (可改) vs 系统类 (只读) */
export function isSystemCategory(category: string): boolean {
  const meta = DICT_META[category]; return meta ? meta.readonly : false;
}

/** 业务类白名单 (与 ALLOWED_DICTIONARY_CATEGORIES 一致, 排除 REGION) */
export const BUSINESS_CATEGORIES: string[] = Object.keys(DICT_META).filter((c) => DICT_META[c]?.readonly !== true);
