// 自然语言搜索服务 (Phase 5 - 用户体验优化)
//
// 职责:
//   1) 解析自然语言查询（如"找去年Q3的合同"）
//   2) 转换为结构化搜索条件
//   3) 支持时间、金额、状态等复杂条件
//   4) 提供搜索建议和纠错
//
// 安全: 纯函数，不触库；解析逻辑在服务端执行

export type ParsedQuery = {
  originalQuery: string;
  keywords: string[];
  timeRange?: {
    from?: Date;
    to?: Date;
    label: string;
  };
  amountRange?: {
    min?: number;
    max?: number;
    label: string;
  };
  status?: string[];
  category?: "customer" | "contract" | "invoice" | "payment";
  filters: Record<string, unknown>;
  confidence: number;
  suggestions?: string[];
};

// 时间关键词映射
const TIME_KEYWORDS: Record<string, () => { from: Date; to: Date; label: string }> = {
  "今天": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { from: start, to: end, label: "今天" };
  },
  "昨天": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    return { from: start, to: end, label: "昨天" };
  },
  "本周": () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 7, 23, 59, 59);
    return { from: start, to: end, label: "本周" };
  },
  "上周": () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 6);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 23, 59, 59);
    return { from: start, to: end, label: "上周" };
  },
  "本月": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from: start, to: end, label: "本月" };
  },
  "上月": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from: start, to: end, label: "上月" };
  },
  "本季度": () => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1);
    const end = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);
    return { from: start, to: end, label: "本季度" };
  },
  "上季度": () => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
    const end = new Date(now.getFullYear(), quarter * 3, 0, 23, 59, 59);
    return { from: start, to: end, label: "上季度" };
  },
  "本年度": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    return { from: start, to: end, label: "本年度" };
  },
  "去年": () => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    return { from: start, to: end, label: "去年" };
  }
};

// 季度关键词
const QUARTER_KEYWORDS: Record<string, (yearOffset: number) => { from: Date; to: Date; label: string }> = {
  "Q1": (yearOffset) => {
    const now = new Date();
    const year = now.getFullYear() - yearOffset;
    return { from: new Date(year, 0, 1), to: new Date(year, 2, 31, 23, 59, 59), label: `${year}年Q1` };
  },
  "Q2": (yearOffset) => {
    const now = new Date();
    const year = now.getFullYear() - yearOffset;
    return { from: new Date(year, 3, 1), to: new Date(year, 5, 30, 23, 59, 59), label: `${year}年Q2` };
  },
  "Q3": (yearOffset) => {
    const now = new Date();
    const year = now.getFullYear() - yearOffset;
    return { from: new Date(year, 6, 1), to: new Date(year, 8, 30, 23, 59, 59), label: `${year}年Q3` };
  },
  "Q4": (yearOffset) => {
    const now = new Date();
    const year = now.getFullYear() - yearOffset;
    return { from: new Date(year, 9, 1), to: new Date(year, 11, 31, 23, 59, 59), label: `${year}年Q4` };
  }
};

// 金额关键词
const AMOUNT_KEYWORDS: Record<string, { min?: number; max?: number; label: string }> = {
  "小额": { max: 10000, label: "1万以下" },
  "中等": { min: 10000, max: 100000, label: "1万-10万" },
  "大额": { min: 100000, max: 1000000, label: "10万-100万" },
  "巨额": { min: 1000000, label: "100万以上" }
};

// 状态关键词
const STATUS_KEYWORDS: Record<string, string[]> = {
  "活跃": ["ACTIVE"],
  "进行中": ["ACTIVE"],
  "已完成": ["CLOSED"],
  "已关闭": ["CLOSED"],
  "草稿": ["DRAFT"],
  "待审批": ["DRAFT"]
};

/**
 * 解析自然语言查询
 */
export function parseNaturalLanguageQuery(query: string): ParsedQuery {
  const originalQuery = query;
  const keywords: string[] = [];
  const filters: Record<string, unknown> = {};
  let confidence = 0.5;
  const suggestions: string[] = [];

  // 1. 提取关键词
  const words = query.split(/[\s,，。！？、]+/).filter(w => w.length > 0);
  keywords.push(...words);

  // 2. 解析时间范围
  let timeRange: ParsedQuery["timeRange"];
  for (const [keyword, getTimeRange] of Object.entries(TIME_KEYWORDS)) {
    if (query.includes(keyword)) {
      timeRange = getTimeRange();
      confidence += 0.2;
      break;
    }
  }

  // 3. 解析季度
  if (!timeRange) {
    const quarterMatch = query.match(/(Q[1-4])\s*(今年|去年|前年)?/);
    if (quarterMatch) {
      const quarter = quarterMatch[1];
      const yearKeyword = quarterMatch[2];
      let yearOffset = 0;
      if (yearKeyword === "去年") yearOffset = 1;
      else if (yearKeyword === "前年") yearOffset = 2;
      else if (yearKeyword === "明年") yearOffset = -1;
      
      const quarterKey = quarter as keyof typeof QUARTER_KEYWORDS;
      const getQuarterRange = QUARTER_KEYWORDS[quarterKey];
      if (getQuarterRange) {
        timeRange = getQuarterRange(yearOffset);
        confidence += 0.2;
      }
    }
  }

  // 4. 解析年份
  const yearMatch = query.match(/(\d{4})\s*年/);
  if (yearMatch && yearMatch[1] && !timeRange) {
    const year = parseInt(yearMatch[1]);
    timeRange = {
      from: new Date(year, 0, 1),
      to: new Date(year, 11, 31, 23, 59, 59),
      label: `${year}年`
    };
    confidence += 0.15;
  }

  // 5. 解析金额范围
  let amountRange: ParsedQuery["amountRange"];
  for (const [keyword, range] of Object.entries(AMOUNT_KEYWORDS)) {
    if (query.includes(keyword)) {
      amountRange = range;
      confidence += 0.15;
      break;
    }
  }

  // 6. 解析金额数字
  const amountMatch = query.match(/(\d+(?:\.\d+)?)\s*(万|千|百万|亿)/);
  if (amountMatch && amountMatch[1] && amountMatch[2] && !amountRange) {
    const value = parseFloat(amountMatch[1]);
    const unit = amountMatch[2];
    let amount = value;
    if (unit === "万") amount *= 10000;
    else if (unit === "千") amount *= 1000;
    else if (unit === "百万") amount *= 1000000;
    else if (unit === "亿") amount *= 100000000;
    
    amountRange = { min: amount, max: amount * 1.5, label: `${value}${unit}` };
    confidence += 0.15;
  }

  // 7. 解析状态
  const statusFilters: string[] = [];
  for (const [keyword, statuses] of Object.entries(STATUS_KEYWORDS)) {
    if (query.includes(keyword)) {
      statusFilters.push(...statuses);
      confidence += 0.1;
    }
  }

  // 8. 识别搜索类别
  let category: ParsedQuery["category"];
  if (query.includes("客户") || query.includes("公司") || query.includes("单位")) {
    category = "customer";
    confidence += 0.1;
  } else if (query.includes("合同") || query.includes("协议")) {
    category = "contract";
    confidence += 0.1;
  } else if (query.includes("发票") || query.includes("开票")) {
    category = "invoice";
    confidence += 0.1;
  } else if (query.includes("回款") || query.includes("收款")) {
    category = "payment";
    confidence += 0.1;
  }

  // 9. 生成建议
  if (confidence < 0.5) {
    suggestions.push("试试更具体的条件，如时间范围或金额");
    suggestions.push("可以使用'本周'、'本月'、'Q3'等时间关键词");
  }

  return {
    originalQuery,
    keywords,
    timeRange,
    amountRange,
    status: statusFilters.length > 0 ? statusFilters : undefined,
    category,
    filters,
    confidence: Math.min(1, confidence),
    suggestions: suggestions.length > 0 ? suggestions : undefined
  };
}

export type CategorySearchParams =
  | { category: "contract"; where: Record<string, unknown> }
  | { category: "customer"; where: Record<string, unknown> }
  | { category: "invoice"; where: Record<string, unknown> }
  | { category: "payment"; where: Record<string, unknown> }
  | { category: undefined; where: Record<string, unknown> };

/**
 * 将解析结果转换为数据库查询条件
 * 注意：返回的 where 按 category 区分，调用方需使用对应模型（Contract/Customer/Invoice/Payment）查询
 */
export function toSearchParams(parsed: ParsedQuery): CategorySearchParams {
  const category = parsed.category ?? "contract";

  switch (category) {
    case "customer":
      return { category, where: buildCustomerWhere(parsed) };
    case "invoice":
      return { category, where: buildInvoiceWhere(parsed) };
    case "payment":
      return { category, where: buildPaymentWhere(parsed) };
    case "contract":
    default:
      return { category: "contract", where: buildContractWhere(parsed) };
  }
}

function buildContractWhere(parsed: ParsedQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (parsed.timeRange) {
    params.startDate = { gte: parsed.timeRange.from };
    params.endDate = { lte: parsed.timeRange.to };
  }

  if (parsed.amountRange) {
    const amountFilter: Record<string, number> = {};
    if (parsed.amountRange.min !== undefined) amountFilter.gte = parsed.amountRange.min;
    if (parsed.amountRange.max !== undefined) amountFilter.lte = parsed.amountRange.max;
    params.totalAmount = amountFilter;
  }

  if (parsed.status) {
    params.status = { in: parsed.status };
  }

  if (parsed.keywords.length > 0) {
    params.OR = parsed.keywords.map(kw => ({
      OR: [
        { title: { contains: kw, mode: "insensitive" } },
        { contractNo: { contains: kw, mode: "insensitive" } },
        { customerName: { contains: kw, mode: "insensitive" } }
      ]
    }));
  }

  return params;
}

function buildCustomerWhere(parsed: ParsedQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (parsed.keywords.length > 0) {
    params.OR = parsed.keywords.map(kw => ({
      OR: [
        { name: { contains: kw, mode: "insensitive" } },
        { code: { contains: kw, mode: "insensitive" } }
      ]
    }));
  }

  return params;
}

function buildInvoiceWhere(parsed: ParsedQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (parsed.timeRange) {
    params.applyDate = { gte: parsed.timeRange.from, lte: parsed.timeRange.to };
  }

  if (parsed.amountRange) {
    const amountFilter: Record<string, number> = {};
    if (parsed.amountRange.min !== undefined) amountFilter.gte = parsed.amountRange.min;
    if (parsed.amountRange.max !== undefined) amountFilter.lte = parsed.amountRange.max;
    params.amount = amountFilter;
  }

  if (parsed.status) {
    params.status = { in: parsed.status };
  }

  if (parsed.keywords.length > 0) {
    params.OR = parsed.keywords.map(kw => ({
      OR: [
        { invoiceNo: { contains: kw, mode: "insensitive" } },
        { customerName: { contains: kw, mode: "insensitive" } }
      ]
    }));
  }

  return params;
}

function buildPaymentWhere(parsed: ParsedQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (parsed.timeRange) {
    params.receivedAt = { gte: parsed.timeRange.from, lte: parsed.timeRange.to };
  }

  if (parsed.amountRange) {
    const amountFilter: Record<string, number> = {};
    if (parsed.amountRange.min !== undefined) amountFilter.gte = parsed.amountRange.min;
    if (parsed.amountRange.max !== undefined) amountFilter.lte = parsed.amountRange.max;
    params.amount = amountFilter;
  }

  if (parsed.status) {
    params.status = { in: parsed.status };
  }

  if (parsed.keywords.length > 0) {
    params.OR = parsed.keywords.map(kw => ({
      OR: [
        { paymentNo: { contains: kw, mode: "insensitive" } },
        { customerName: { contains: kw, mode: "insensitive" } }
      ]
    }));
  }

  return params;
}

/**
 * 获取搜索建议
 */
export function getSearchSuggestions(query: string): string[] {
  const suggestions: string[] = [];
  const parsed = parseNaturalLanguageQuery(query);

  if (parsed.confidence < 0.5) {
    suggestions.push("试试：'找去年Q3的合同'");
    suggestions.push("试试：'大额客户'");
    suggestions.push("试试：'本月活跃合同'");
  }

  if (!parsed.timeRange) {
    suggestions.push("添加时间条件：'本周'、'本月'、'Q3'");
  }

  if (!parsed.category) {
    suggestions.push("指定类别：'客户'、'合同'、'发票'、'回款'");
  }

  return suggestions.slice(0, 3);
}
