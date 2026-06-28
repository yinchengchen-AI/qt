// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- 字典/工作流模板用 JS 字面量集中维护, 暂不细化类型
// 种子: 5 角色 + 5 部门 + 字典 (系统管理数据)
// 业务数据 (客户/合同/项目/发票/回款/跟进) 不再 seed, 生产用真实数据
// 初始账号: 跑 pnpm create-admin 自行创建
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { ROLE_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});




async function main() {
  const roleDefs = [
    { code: "ADMIN",   name: "管理员",   description: "系统管理员" },
    { code: "SALES",   name: "业务人员", description: "负责客户/合同/项目推进" },
    { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
    { code: "OPS",     name: "行政人员", description: "基础信息维护" },
    { code: "EXPERT",  name: "技术专家", description: "承担现场勘查、报告撰写等专业工作" }
  ] as const;

  for (const r of roleDefs) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, permissions: ROLE_PERMISSIONS[r.code] as unknown as object, isSystem: true },
      create: {
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: ROLE_PERMISSIONS[r.code] as unknown as object,
        isSystem: true
      }
    });
  }

  // ----- 用户不在 seed 中创建 -----
  // 初始管理员用 scripts/create-admin.ts 创建: pnpm create-admin --employeeNo admin --name "..." --email ... --password ...

  const dictDefs: Array<{ category: string; code: string; label: string; sort: number }> = [
    { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "管理咨询", sort: 1 },
    { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "宣传教育培训", sort: 2 },
    { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "安全隐患排查", sort: 3 },
    { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案/演练", sort: 4 },
    { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评估", sort: 5 },
    { category: "SERVICE_TYPE", code: "SYS_BUILDING", label: "安全体系建设", sort: 6 },
    { category: "SERVICE_TYPE", code: "RESIDENT", label: "派驻托管服务", sort: 7 },
    { category: "SERVICE_TYPE", code: "SURVEY", label: "普查核验服务", sort: 8 },
    { category: "SERVICE_TYPE", code: "STANDARDIZATION", label: "标准化体系创建/换证", sort: 9 },
    { category: "SERVICE_TYPE", code: "OTHER", label: "其他", sort: 99 },
    { category: "CUSTOMER_TYPE", code: "ENTERPRISE", label: "企业", sort: 1 },
    { category: "CUSTOMER_TYPE", code: "GOV", label: "政府", sort: 2 },
    { category: "CUSTOMER_TYPE", code: "OTHER", label: "其他", sort: 3 },



    // 客户规模 - LARGE 大型 | MEDIUM 中型 | SMALL 小型 | MICRO 微型
    { category: "CUSTOMER_SCALE", code: "LARGE",  label: "大型", sort: 1 },
    { category: "CUSTOMER_SCALE", code: "MEDIUM", label: "中型", sort: 2 },
    { category: "CUSTOMER_SCALE", code: "SMALL",  label: "小型", sort: 3 },
    { category: "CUSTOMER_SCALE", code: "MICRO",  label: "微型", sort: 4 },
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
    // 收款方式 - 列表 / 详情 / Drawer 都要
    { category: "PAYMENT_RECEIVE_METHOD", code: "BANK_TRANSFER", label: "银行转账", sort: 1 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "CHECK", label: "支票", sort: 2 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "CASH", label: "现金", sort: 3 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "WECHAT", label: "微信", sort: 4 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "ALIPAY", label: "支付宝", sort: 5 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "OTHER", label: "其他", sort: 99 },
    // 跟进方式 / 结果 - 客户详情页的"新增跟进"要用
    { category: "FOLLOW_METHOD", code: "VISIT", label: "上门拜访", sort: 1 },
    { category: "FOLLOW_METHOD", code: "CALL", label: "电话", sort: 2 },
    { category: "FOLLOW_METHOD", code: "WECHAT", label: "微信", sort: 3 },
    { category: "FOLLOW_METHOD", code: "EMAIL", label: "邮件", sort: 4 },
    { category: "FOLLOW_METHOD", code: "OTHER", label: "其他", sort: 99 },
    { category: "FOLLOW_RESULT", code: "INTENT", label: "有意向", sort: 1 },
    { category: "FOLLOW_RESULT", code: "NO_INTENT", label: "无意向", sort: 2 },
    { category: "FOLLOW_RESULT", code: "PENDING", label: "待定", sort: 3 },
    { category: "FOLLOW_RESULT", code: "SIGNED", label: "已签约", sort: 4 },
    // 人员证书类型 - 标书素材库 v1
    { category: "PERSONNEL_CERT_TYPE", code: "REGISTERED_SAFETY_ENGINEER", label: "注册安全工程师", sort: 10 },
    { category: "PERSONNEL_CERT_TYPE", code: "SAFETY_EVALUATOR",          label: "安全评价师",       sort: 20 },
    { category: "PERSONNEL_CERT_TYPE", code: "EMERGENCY_RESCUER",         label: "应急救援员",       sort: 30 },
    { category: "PERSONNEL_CERT_TYPE", code: "TRAINING_INSTRUCTOR",       label: "培训师资",         sort: 40 },
    { category: "PERSONNEL_CERT_TYPE", code: "SPECIAL_OPERATION",         label: "特种作业操作证",   sort: 50 },
    { category: "PERSONNEL_CERT_TYPE", code: "OTHER",                     label: "其他",             sort: 999 },
    // === 以下 8 类状态机字典, 以 prisma/schema.prisma 注释为权威 (schema 允许的 code) ===
    // === 同步 lib/enum-maps.ts 现有 label, 方便后续 useDict 取代 hardcode ===
    // 客户状态机
    { category: "CUSTOMER_STATUS", code: "LEAD",        label: "线索",     sort: 1 },
    { category: "CUSTOMER_STATUS", code: "NEGOTIATING", label: "洽谈中",   sort: 2 },
    { category: "CUSTOMER_STATUS", code: "SIGNED",      label: "已签约",   sort: 3 },
    { category: "CUSTOMER_STATUS", code: "LOST",        label: "已流失",   sort: 4 },
    { category: "CUSTOMER_STATUS", code: "FROZEN",      label: "已冻结",   sort: 5 },
    // 合同状态机
    { category: "CONTRACT_STATUS", code: "DRAFT",  label: "草稿",     sort: 1 },
    { category: "CONTRACT_STATUS", code: "ACTIVE", label: "生效中",   sort: 2 },
    { category: "CONTRACT_STATUS", code: "CLOSED", label: "已完结",   sort: 3 },
    // 发票类型
    { category: "INVOICE_TYPE", code: "VAT_SPECIAL",    label: "增值税专用发票", sort: 1 },
    { category: "INVOICE_TYPE", code: "VAT_GENERAL",    label: "增值税普通发票", sort: 2 },
    { category: "INVOICE_TYPE", code: "VAT_ELECTRONIC", label: "增值税电子专票", sort: 3 },
    { category: "INVOICE_TYPE", code: "ELEC_NORMAL",    label: "电子普通发票",     sort: 4 },
    // 开票状态机
    { category: "INVOICE_STATUS", code: "DRAFT",           label: "草稿",       sort: 1 },
    { category: "INVOICE_STATUS", code: "PENDING_FINANCE", label: "待财务审核", sort: 2 },
    { category: "INVOICE_STATUS", code: "ISSUED",          label: "已开票",     sort: 3 },
    { category: "INVOICE_STATUS", code: "REJECTED",        label: "已驳回",     sort: 4 },
    { category: "INVOICE_STATUS", code: "VOIDED",          label: "已作废",     sort: 5 },
    { category: "INVOICE_STATUS", code: "RED_FLUSHED",     label: "已红冲",     sort: 6 },
    // 回款状态机
    { category: "PAYMENT_STATUS", code: "PLANNED",    label: "计划中",   sort: 1 },
    { category: "PAYMENT_STATUS", code: "CONFIRMED",  label: "已确认",   sort: 2 },
    { category: "PAYMENT_STATUS", code: "RECONCILED", label: "已对账",   sort: 3 },
    { category: "PAYMENT_STATUS", code: "REFUNDED",   label: "已退款",   sort: 4 },
    { category: "PAYMENT_STATUS", code: "CANCELLED",  label: "已取消",   sort: 5 },
    // 合同付款方式
    { category: "CONTRACT_PAYMENT_METHOD", code: "LUMP_SUM",   label: "一次性", sort: 1 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_PHASE",   label: "按阶段", sort: 2 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_MONTH",   label: "按月",   sort: 3 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_QUARTER", label: "按季",   sort: 4 },
    // 审批动作
    { category: "REVIEW_ACTION", code: "SUBMIT",   label: "提交审批", sort: 1 },
    { category: "REVIEW_ACTION", code: "APPROVE",  label: "批准",     sort: 2 },
    { category: "REVIEW_ACTION", code: "REJECT",   label: "驳回",     sort: 3 },
    { category: "REVIEW_ACTION", code: "WITHDRAW", label: "撤回",     sort: 4 },
    { category: "REVIEW_ACTION", code: "EXECUTE",  label: "开始执行", sort: 5 },
    { category: "REVIEW_ACTION", code: "SUSPEND",  label: "暂停",     sort: 6 },
    { category: "REVIEW_ACTION", code: "RESUME",   label: "恢复",     sort: 7 },
    { category: "REVIEW_ACTION", code: "COMPLETE", label: "结清",     sort: 8 },
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
    { category: "CONTRACT_TYPE", code: "OTHER", label: "其他", sort: 99 },
  ];
  for (const d of dictDefs) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: d
    });
  }


  // ----- 部门 seed -----
  // 3 个顶级部门(业务/技术/财务)+ 2 个技术部下子部门
  const techDept = await prisma.department.upsert({
    where: { code: "tech" },
    update: { name: "技术部", sort: 2, isActive: true },
    create: { id: "dept_seed_tech", code: "tech", name: "技术部", sort: 2, isActive: true }
  });
  const _bizDept = await prisma.department.upsert({
    where: { code: "biz" },
    update: { name: "业务部", sort: 1, isActive: true },
    create: { id: "dept_seed_biz", code: "biz", name: "业务部", sort: 1, isActive: true }
  });
  const _finDept = await prisma.department.upsert({
    where: { code: "fin" },
    update: { name: "财务部", sort: 3, isActive: true },
    create: { id: "dept_seed_fin", code: "fin", name: "财务部", sort: 3, isActive: true }
  });
  const _techOps = await prisma.department.upsert({
    where: { code: "tech_ops" },
    update: { name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true },
    create: { id: "dept_seed_tech_ops", code: "tech_ops", name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true }
  });
  const _techWeb = await prisma.department.upsert({
    where: { code: "tech_web" },
    update: { name: "前端组", parentId: techDept.id, sort: 2, isActive: true },
    create: { id: "dept_seed_tech_web", code: "tech_web", name: "前端组", parentId: techDept.id, sort: 2, isActive: true }
  });

  console.log(`✅ 系统管理 seed 完成: 5 角色 + 5 部门 + ${dictDefs.length} 字典`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
