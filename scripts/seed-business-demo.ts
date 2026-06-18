#!/usr/bin/env tsx
// @ts-nocheck — 独立 tsx 种子脚本, 不用走 lib/ 的严格类型, 见 scripts/seed-business-demo.README.md
/**
 * 业务 demo 种子: 5 套完整数据链 (Customer -> Contract -> Project -> Invoice -> Payment).
 *
 * 5 套链覆盖:
 *   #1 早期  - 已签约, 项目 IN_PROGRESS, 已开 DRAFT 发票, 暂无回款
 *   #2 中期  - 已签约, 项目 IN_PROGRESS, 发票 ISSUED, 部分回款
 *   #3 后期  - 已签约, 项目 DELIVERED,  全额开票, 全额回款
 *   #4 长期  - 项目 CLOSED, 全额开票, 全额回款
 *   #5 流失  - 客户状态 LOST, 无合同/项目/发票
 *
 * 业务号约定: DEMO-XXX-NNN 前缀, 不走 nextBusinessNo, 不污染 Sequence
 * owner / createdBy / updatedBy 全部复用现有 ADMIN 用户
 * 用 prisma.$transaction + SET LOCAL app.bypass_rls='on' 临时绕过 SALES 行级隔离
 *
 * 用法:
 *   pnpm tsx scripts/seed-business-demo.ts            # 默认 dry-run
 *   pnpm tsx scripts/seed-business-demo.ts --apply    # 真写库
 *   pnpm tsx scripts/seed-business-demo.ts --clean    # 清掉所有 DEMO- 业务号
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const DEMO_TAG = "DEMO-";

async function ensureAdmin() {
  const admin = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" } },
    select: { id: true, name: true }
  });
  if (!admin) throw new Error("找不到 ADMIN 用户, 请先 pnpm create-admin");
  return admin;
}

function bypassRls(fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
    return fn(tx);
  });
}

function pad(n, len) { return String(n).padStart(len, "0"); }

function makeIds(no) {
  return {
    customerCode: `DEMO-CUS-${pad(no, 3)}`,
    contractNo:   `DEMO-CT-${pad(no, 3)}`,
    projectNo:    `DEMO-P-${pad(no, 3)}`,
    invoiceNo:    `DEMO-INV-${pad(no, 3)}`,
    paymentNo:    `DEMO-PAY-${pad(no, 3)}`
  };
}

function taxOf(amount, taxRate = 0.06) {
  const amountExcludingTax = +(amount / (1 + taxRate)).toFixed(2);
  const taxAmount = +(amount - amountExcludingTax).toFixed(2);
  return { taxRate, taxAmount, amountExcludingTax };
}

function serviceLabel(t) {
  return ({
    SAFETY_CONSULT: "安全管理咨询",
    SAFETY_TRAIN: "安全培训",
    HAZARD_ANA: "隐患排查",
    EMERGENCY_PLAN: "应急预案",
    EVALUATION: "安全评估",
    OTHER: "其他服务"
  })[t];
}

const LINKS = [
  { no: 1, customerName: "杭州捷旭科技有限公司", customerType: "ENTERPRISE", scale: "MEDIUM",
    industry: "信息传输/软件", province: "浙江省", city: "杭州市",
    contactName: "张志远", contactPhone: "13800000001",
    customerStatus: "SIGNED", contractStatus: "EFFECTIVE", serviceType: "HAZARD_ANA",
    totalAmount: 180000, paymentMethod: "BY_PHASE",
    projectStatus: "IN_PROGRESS", invoiceStatus: "DRAFT", invoiceAmount: 90000, paymentAmount: null,
    remark: "链 #1 早期: 已签约, 项目执行中, 发票草稿" },
  { no: 2, customerName: "杭州川泽电子科技有限公司", customerType: "ENTERPRISE", scale: "SMALL",
    industry: "制造业", province: "浙江省", city: "杭州市",
    contactName: "李文涛", contactPhone: "13800000002",
    customerStatus: "SIGNED", contractStatus: "EFFECTIVE", serviceType: "SAFETY_CONSULT",
    totalAmount: 80000, paymentMethod: "LUMP_SUM",
    projectStatus: "IN_PROGRESS", invoiceStatus: "ISSUED", invoiceAmount: 40000, paymentAmount: 20000,
    remark: "链 #2 中期: 已开部分票, 部分回款" },
  { no: 3, customerName: "杭州宏远印刷有限公司", customerType: "ENTERPRISE", scale: "MICRO",
    industry: "印刷包装", province: "浙江省", city: "杭州市",
    contactName: "王慧敏", contactPhone: "13800000003",
    customerStatus: "SIGNED", contractStatus: "COMPLETED", serviceType: "EMERGENCY_PLAN",
    totalAmount: 50000, paymentMethod: "LUMP_SUM",
    projectStatus: "DELIVERED", invoiceStatus: "ISSUED", invoiceAmount: 50000, paymentAmount: 50000,
    remark: "链 #3 后期: 项目交付, 全额开票, 全额回款" },
  { no: 4, customerName: "杭州军途重卡汽车服务有限公司", customerType: "OTHER", scale: "LARGE",
    industry: "运输/物流", province: "浙江省", city: "杭州市",
    contactName: "陈建国", contactPhone: "13800000004",
    customerStatus: "SIGNED", contractStatus: "COMPLETED", serviceType: "EVALUATION",
    totalAmount: 280000, paymentMethod: "BY_QUARTER",
    projectStatus: "CLOSED", invoiceStatus: "ISSUED", invoiceAmount: 280000, paymentAmount: 280000,
    remark: "链 #4 长期: 多年前签约, 项目已 CLOSED, 全部回款" },
  { no: 5, customerName: "杭州浩润电气有限公司", customerType: "ENTERPRISE", scale: "SMALL",
    industry: "电气机械", province: "浙江省", city: "杭州市",
    contactName: "周晓东", contactPhone: "13800000005",
    customerStatus: "LOST", contractStatus: null, serviceType: null,
    totalAmount: 0, paymentMethod: "LUMP_SUM",
    projectStatus: null, invoiceStatus: null, invoiceAmount: null, paymentAmount: null,
    remark: "链 #5 流失: 无合同, 客户状态 LOST" }
];

async function seedOneTx(tx, adminId, link) {
  const ids = makeIds(link.no);
  const created = [];

  const customer = await tx.customer.create({
    data: {
      code: ids.customerCode, name: link.customerName, customerType: link.customerType,
      scale: link.scale, industry: link.industry, province: link.province, city: link.city,
      contactName: link.contactName, contactPhone: link.contactPhone,
      ownerUserId: adminId, status: link.customerStatus,
      createdById: adminId, updatedById: adminId
    }
  });
  created.push(`Customer ${ids.customerCode}`);

  if (!link.contractStatus) return { created };

  const signDate = new Date("2026-03-01");
  const startDate = new Date("2026-03-05");
  const endDate = new Date("2026-12-31");
  const t1 = taxOf(link.totalAmount);

  const contract = await tx.contract.create({
    data: {
      contractNo: ids.contractNo, customerId: customer.id, customerName: customer.name,
      title: `${link.customerName} - ${serviceLabel(link.serviceType)}合同`,
      serviceType: link.serviceType,
      signDate, startDate, endDate,
      totalAmount: link.totalAmount, taxRate: t1.taxRate, taxAmount: t1.taxAmount, amountExcludingTax: t1.amountExcludingTax,
      paymentMethod: link.paymentMethod, status: link.contractStatus,
      ownerUserId: adminId, signerId: adminId, attachments: [],
      createdById: adminId, updatedById: adminId
    }
  });
  created.push(`Contract ${ids.contractNo}`);

  if (!link.projectStatus) return { created };

  const project = await tx.project.create({
    data: {
      projectNo: ids.projectNo, contractId: contract.id,
      name: `${link.customerName} - ${serviceLabel(link.serviceType)}项目`,
      serviceScope: `${serviceLabel(link.serviceType)}全流程服务`,
      managerUserId: adminId, startDate, endDate,
      budgetAmount: link.totalAmount, status: link.projectStatus,
      createdById: adminId, updatedById: adminId
    }
  });
  created.push(`Project ${ids.projectNo}`);

  if (!link.invoiceStatus || !link.invoiceAmount) return { created };

  const inv = taxOf(link.invoiceAmount);
  const invoice = await tx.invoice.create({
    data: {
      invoiceNo: ids.invoiceNo, contractId: contract.id, customerId: customer.id,
      customerName: customer.name, invoiceType: "VAT_SPECIAL",
      amount: link.invoiceAmount, taxRate: inv.taxRate, taxAmount: inv.taxAmount, amountExcludingTax: inv.amountExcludingTax,
      applyDate: new Date("2026-04-15"),
      actualIssueDate: link.invoiceStatus === "ISSUED" ? new Date("2026-04-20") : null,
      titleType: "COMPANY", titleName: customer.name,
      taxNo: `9133010${pad(link.no, 6)}MA`,
      status: link.invoiceStatus,
      applicantUserId: adminId,
      financeUserId: link.invoiceStatus === "ISSUED" ? adminId : null,
      reviewedAt: link.invoiceStatus === "ISSUED" ? new Date("2026-04-19") : null,
      reviewComment: link.invoiceStatus === "ISSUED" ? "demo 数据, 已审核" : null,
      createdById: adminId, updatedById: adminId
    }
  });
  created.push(`Invoice ${ids.invoiceNo}`);

  if (!link.paymentAmount) return { created };

  await tx.payment.create({
    data: {
      paymentNo: ids.paymentNo, customerId: customer.id, contractId: contract.id, invoiceId: invoice.id,
      amount: link.paymentAmount, receivedAt: new Date("2026-05-10"),
      method: "BANK_TRANSFER", bankName: "中国工商银行杭州分行",
      bankRefNo: `DEMO-BANK-${pad(link.no, 6)}`, status: "CONFIRMED",
      recorderUserId: adminId, reconcileUserId: adminId, reconciledAt: new Date("2026-05-12"),
      createdById: adminId, updatedById: adminId
    }
  });
  created.push(`Payment ${ids.paymentNo}`);

  return { created };
}

async function cleanAll() {
  return bypassRls(async (tx) => {
    const payments = await tx.payment.deleteMany({ where: { paymentNo: { startsWith: `${DEMO_TAG}PAY-` } } });
    const invoices = await tx.invoice.deleteMany({ where: { invoiceNo: { startsWith: `${DEMO_TAG}INV-` } } });
    const projects = await tx.project.deleteMany({ where: { projectNo: { startsWith: `${DEMO_TAG}P-` } } });
    const contracts = await tx.contract.deleteMany({ where: { contractNo: { startsWith: `${DEMO_TAG}CT-` } } });
    const customers = await tx.customer.deleteMany({ where: { code: { startsWith: `${DEMO_TAG}CUS-` } } });
    return { Payment: payments.count, Invoice: invoices.count, Project: projects.count,
             Contract: contracts.count, Customer: customers.count };
  });
}

async function main() {
  if (CLEAN) {
    const r = await cleanAll();
    console.log(`[CLEAN] ${JSON.stringify(r)}`);
    return;
  }

  const admin = await ensureAdmin();
  console.log(`[INFO] 复用 ADMIN: ${admin.name} (${admin.id})`);
  console.log(`[INFO] 模式: ${APPLY ? "APPLY (写库)" : "DRY-RUN (只打印)"}\n`);

  let totalCreated = 0;
  for (const link of LINKS) {
    console.log(`# 链 ${link.no}  ${link.remark}`);
    console.log(`  客户: ${link.customerName} (${link.customerType}/${link.scale}/${link.industry}) status=${link.customerStatus}`);
    if (link.contractStatus) {
      console.log(`  合同: ${serviceLabel(link.serviceType)} ¥${link.totalAmount.toLocaleString()} [${link.contractStatus}] 付款方式=${link.paymentMethod}`);
    } else { console.log(`  合同: - (无)`); }
    if (link.projectStatus) { console.log(`  项目: [${link.projectStatus}]`); } else { console.log(`  项目: -`); }
    if (link.invoiceStatus) { console.log(`  发票: ¥${(link.invoiceAmount || 0).toLocaleString()} [${link.invoiceStatus}]`); } else { console.log(`  发票: -`); }
    if (link.paymentAmount) { console.log(`  回款: ¥${link.paymentAmount.toLocaleString()}`); } else { console.log(`  回款: -`); }

    if (APPLY) {
      const r = await bypassRls((tx) => seedOneTx(tx, admin.id, link));
      console.log(`  -> 写入: ${r.created.length} 个实体 ${JSON.stringify(r.created)}`);
      totalCreated += r.created.length;
    }
    console.log("");
  }

  if (APPLY) {
    console.log(`[OK] 写入完成, 共 ${totalCreated} 个 demo 业务实体.`);
  } else {
    console.log(`[DRY-RUN] 未写库. 加 --apply 真写: pnpm tsx scripts/seed-business-demo.ts --apply`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("[FATAL]", e); process.exit(1); });
