#!/usr/bin/env tsx
/**
 * 只插 8 类数据字典(57 条),不污染空库。 与 prisma/seed.ts 里的 dictDefs
 * 保持完全一致 (单点真理 = prisma/seed.ts); 之后字典若有更新, 同步两边即可。
 *
 * 适用: 生产部署, 留空库, 但需要字典下拉(行业/规模/来源/付款方式 等)正常工作。
 *
 * 用法:
 *   pnpm seed-dicts
 */
import { prisma } from "@/lib/prisma";

type DictDef = { category: string; code: string; label: string; sort: number };

const DICT_DEFS: readonly DictDef[] = [
  // 服务类型
  { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "安全咨询", sort: 1 },
  { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "安全培训", sort: 2 },
  { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "隐患排查", sort: 3 },
  { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案", sort: 4 },
  { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评价", sort: 5 },
  { category: "SERVICE_TYPE", code: "OTHER", label: "其他", sort: 99 },
  // 客户类型
  { category: "CUSTOMER_TYPE", code: "ENTERPRISE", label: "企业", sort: 1 },
  { category: "CUSTOMER_TYPE", code: "GOV", label: "政府", sort: 2 },
  { category: "CUSTOMER_TYPE", code: "OTHER", label: "其他", sort: 3 },
  // 客户规模
  { category: "CUSTOMER_SCALE", code: "LARGE", label: "大型", sort: 1 },
  { category: "CUSTOMER_SCALE", code: "MEDIUM", label: "中型", sort: 2 },
  { category: "CUSTOMER_SCALE", code: "SMALL", label: "小型", sort: 3 },
  { category: "CUSTOMER_SCALE", code: "MICRO", label: "微型", sort: 4 },
  // 客户行业
  { category: "CUSTOMER_INDUSTRY", code: "MANUFACTURING", label: "制造业", sort: 1 },
  { category: "CUSTOMER_INDUSTRY", code: "CHEMICAL", label: "化工", sort: 2 },
  { category: "CUSTOMER_INDUSTRY", code: "CONSTRUCTION", label: "建筑/房地产", sort: 3 },
  { category: "CUSTOMER_INDUSTRY", code: "ENERGY", label: "能源/电力", sort: 4 },
  { category: "CUSTOMER_INDUSTRY", code: "MINING", label: "矿山", sort: 5 },
  { category: "CUSTOMER_INDUSTRY", code: "TRANSPORTATION", label: "交通运输", sort: 6 },
  { category: "CUSTOMER_INDUSTRY", code: "WAREHOUSING", label: "仓储物流", sort: 7 },
  { category: "CUSTOMER_INDUSTRY", code: "COMMERCE", label: "商业贸易", sort: 8 },
  { category: "CUSTOMER_INDUSTRY", code: "FINANCE", label: "金融", sort: 9 },
  { category: "CUSTOMER_INDUSTRY", code: "HEALTHCARE", label: "医疗医药", sort: 10 },
  { category: "CUSTOMER_INDUSTRY", code: "EDUCATION", label: "教育", sort: 11 },
  { category: "CUSTOMER_INDUSTRY", code: "IT", label: "信息技术", sort: 12 },
  { category: "CUSTOMER_INDUSTRY", code: "GOVERNMENT", label: "政府/事业单位", sort: 13 },
  { category: "CUSTOMER_INDUSTRY", code: "SERVICES", label: "服务业", sort: 14 },
  { category: "CUSTOMER_INDUSTRY", code: "AGRICULTURE", label: "农林牧渔", sort: 15 },
  { category: "CUSTOMER_INDUSTRY", code: "F_AND_B", label: "餐饮酒店", sort: 16 },
  { category: "CUSTOMER_INDUSTRY", code: "OTHER", label: "其他", sort: 99 },
  // 客户来源
  { category: "CUSTOMER_SOURCE", code: "EXHIBITION", label: "展会", sort: 1 },
  { category: "CUSTOMER_SOURCE", code: "REFERRAL", label: "客户介绍/转介绍", sort: 2 },
  { category: "CUSTOMER_SOURCE", code: "WEBSITE", label: "官网咨询", sort: 3 },
  { category: "CUSTOMER_SOURCE", code: "PHONE", label: "电话来访", sort: 4 },
  { category: "CUSTOMER_SOURCE", code: "COLD_VISIT", label: "主动拜访", sort: 5 },
  { category: "CUSTOMER_SOURCE", code: "BIDDING", label: "招投标", sort: 6 },
  { category: "CUSTOMER_SOURCE", code: "PARTNER", label: "合作伙伴", sort: 7 },
  { category: "CUSTOMER_SOURCE", code: "MEDIA", label: "媒体广告", sort: 8 },
  { category: "CUSTOMER_SOURCE", code: "SOCIAL_MEDIA", label: "社交媒体", sort: 9 },
  { category: "CUSTOMER_SOURCE", code: "GOV_REFERRAL", label: "政府推荐", sort: 10 },
  { category: "CUSTOMER_SOURCE", code: "REPEAT", label: "老客户", sort: 11 },
  { category: "CUSTOMER_SOURCE", code: "OTHER", label: "其他", sort: 99 },
  // 收款方式
  { category: "PAYMENT_RECEIVE_METHOD", code: "BANK_TRANSFER", label: "银行转账", sort: 1 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "CHECK", label: "支票", sort: 2 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "CASH", label: "现金", sort: 3 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "WECHAT", label: "微信", sort: 4 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "ALIPAY", label: "支付宝", sort: 5 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "OTHER", label: "其他", sort: 99 },
  // 跟进方式
  { category: "FOLLOW_METHOD", code: "VISIT", label: "上门拜访", sort: 1 },
  { category: "FOLLOW_METHOD", code: "CALL", label: "电话", sort: 2 },
  { category: "FOLLOW_METHOD", code: "WECHAT", label: "微信", sort: 3 },
  { category: "FOLLOW_METHOD", code: "EMAIL", label: "邮件", sort: 4 },
  { category: "FOLLOW_METHOD", code: "OTHER", label: "其他", sort: 99 },
  // 跟进结果
  { category: "FOLLOW_RESULT", code: "INTENT", label: "有意向", sort: 1 },
  { category: "FOLLOW_RESULT", code: "NO_INTENT", label: "无意向", sort: 2 },
  { category: "FOLLOW_RESULT", code: "PENDING", label: "待定", sort: 3 },
  { category: "FOLLOW_RESULT", code: "SIGNED", label: "已签约", sort: 4 }
];

async function main(): Promise<void> {
  // 按 category 分组, 方便日志看
  const byCategory = new Map<string, number>();
  for (const d of DICT_DEFS) {
    byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: { ...d, isActive: true }
    });
  }
  console.log(`[OK] upserted ${DICT_DEFS.length} dictionary entries across ${byCategory.size} categories:`);
  for (const [cat, n] of byCategory) {
    console.log(`  - ${cat}: ${n}`);
  }
  console.log(`\n[OK] dictionaries ready. Try \`/api/dictionaries?category=CUSTOMER_INDUSTRY\` to verify.`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
