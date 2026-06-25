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
  { category: "FOLLOW_RESULT", code: "SIGNED", label: "已签约", sort: 4 },
  // === 以下 8 类状态机字典(与 prisma/seed.ts 同步, 单点真理 = prisma/seed.ts) ===
  { category: "CUSTOMER_STATUS", code: "LEAD", label: "线索", sort: 1 },
  { category: "CUSTOMER_STATUS", code: "NEGOTIATING", label: "洽谈中", sort: 2 },
  { category: "CUSTOMER_STATUS", code: "SIGNED", label: "已签约", sort: 3 },
  { category: "CUSTOMER_STATUS", code: "LOST", label: "已流失", sort: 4 },
  { category: "CUSTOMER_STATUS", code: "FROZEN", label: "已冻结", sort: 5 },
  { category: "CONTRACT_STATUS", code: "DRAFT",  label: "草稿",   sort: 1 },
  { category: "CONTRACT_STATUS", code: "ACTIVE", label: "生效中", sort: 2 },
  { category: "CONTRACT_STATUS", code: "CLOSED", label: "已完结", sort: 3 },
  { category: "PROJECT_STATUS", code: "PLANNED", label: "计划中", sort: 1 },
  { category: "PROJECT_STATUS", code: "IN_PROGRESS", label: "进行中", sort: 2 },
  { category: "PROJECT_STATUS", code: "SUSPENDED", label: "已暂停", sort: 3 },
  { category: "PROJECT_STATUS", code: "DELIVERED", label: "已交付", sort: 4 },
  { category: "PROJECT_STATUS", code: "ACCEPTED", label: "已验收", sort: 5 },
  { category: "PROJECT_STATUS", code: "CLOSED", label: "已关闭", sort: 6 },
  { category: "PROJECT_STATUS", code: "CANCELLED", label: "已取消", sort: 7 },
  { category: "INVOICE_TYPE", code: "VAT_SPECIAL", label: "增值税专用发票", sort: 1 },
  { category: "INVOICE_TYPE", code: "VAT_GENERAL", label: "增值税普通发票", sort: 2 },
  { category: "INVOICE_TYPE", code: "VAT_ELECTRONIC", label: "增值税电子专票", sort: 3 },
  { category: "INVOICE_TYPE", code: "ELEC_NORMAL", label: "电子普通发票", sort: 4 },
  { category: "INVOICE_STATUS", code: "DRAFT", label: "草稿", sort: 1 },
  { category: "INVOICE_STATUS", code: "PENDING_FINANCE", label: "待财务审核", sort: 2 },
  { category: "INVOICE_STATUS", code: "ISSUED", label: "已开票", sort: 3 },
  { category: "INVOICE_STATUS", code: "REJECTED", label: "已驳回", sort: 4 },
  { category: "INVOICE_STATUS", code: "VOIDED", label: "已作废", sort: 5 },
  { category: "INVOICE_STATUS", code: "RED_FLUSHED", label: "已红冲", sort: 6 },
  { category: "PAYMENT_STATUS", code: "PLANNED", label: "计划中", sort: 1 },
  { category: "PAYMENT_STATUS", code: "CONFIRMED", label: "已确认", sort: 2 },
  { category: "PAYMENT_STATUS", code: "RECONCILED", label: "已对账", sort: 3 },
  { category: "PAYMENT_STATUS", code: "REFUNDED", label: "已退款", sort: 4 },
  { category: "PAYMENT_STATUS", code: "CANCELLED", label: "已取消", sort: 5 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "LUMP_SUM", label: "一次性", sort: 1 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_PHASE", label: "按阶段", sort: 2 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_MONTH", label: "按月", sort: 3 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_QUARTER", label: "按季", sort: 4 },
  { category: "REVIEW_ACTION", code: "SUBMIT", label: "提交审批", sort: 1 },
  { category: "REVIEW_ACTION", code: "APPROVE", label: "批准", sort: 2 },
  { category: "REVIEW_ACTION", code: "REJECT", label: "驳回", sort: 3 },
  { category: "REVIEW_ACTION", code: "WITHDRAW", label: "撤回", sort: 4 },
  { category: "REVIEW_ACTION", code: "EXECUTE", label: "开始执行", sort: 5 },
  { category: "REVIEW_ACTION", code: "SUSPEND", label: "暂停", sort: 6 },
  { category: "REVIEW_ACTION", code: "RESUME", label: "恢复", sort: 7 },
  { category: "REVIEW_ACTION", code: "COMPLETE", label: "结清", sort: 8 },
  // 员工档案 - 最高学历 / 教育经历-学历
  { category: "EDUCATION_LEVEL", code: "HIGH_SCHOOL", label: "高中", sort: 1 },
  { category: "EDUCATION_LEVEL", code: "JUNIOR_COLLEGE", label: "大专", sort: 2 },
  { category: "EDUCATION_LEVEL", code: "BACHELOR", label: "本科", sort: 3 },
  { category: "EDUCATION_LEVEL", code: "MASTER", label: "硕士", sort: 4 },
  { category: "EDUCATION_LEVEL", code: "DOCTORATE", label: "博士", sort: 5 },
  { category: "EDUCATION_LEVEL", code: "OTHER", label: "其他", sort: 99 },
  // 员工档案 - 合同类型
  { category: "CONTRACT_TYPE", code: "LABOR", label: "劳动合同", sort: 1 },
  { category: "CONTRACT_TYPE", code: "SERVICE", label: "劳务合同", sort: 2 },
  { category: "CONTRACT_TYPE", code: "INTERNSHIP", label: "实习协议", sort: 3 },
  { category: "CONTRACT_TYPE", code: "OTHER", label: "其他", sort: 99 }
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
