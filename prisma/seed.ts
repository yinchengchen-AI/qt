// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- 业务数据全部由 patches/_seed_writer.mjs 注入生成,数据结构是 JS 字面量暂不细化
// 种子：4 角色 + 4 账号 + 字典
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import bcrypt from "bcrypt";
import { ROLE_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});



// =====================================================
// 业务数据 seed — 客户/联系人/跟进/合同/项目/发票/回款/公告/消息
// 幂等：若已存在任何 Customer 则跳过整个业务 seed
// =====================================================
async function seedBusinessData() {
  const existingCust = await prisma.customer.findFirst({ select: { id: true } });
  if (existingCust) { console.log("⏭️  业务数据已存在，跳过"); return; }

  const [admin, sales, finance, ops] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { employeeNo: "admin" } }),
    prisma.user.findUniqueOrThrow({ where: { employeeNo: "sales" } }),
    prisma.user.findUniqueOrThrow({ where: { employeeNo: "finance" } }),
    prisma.user.findUniqueOrThrow({ where: { employeeNo: "ops" } })
  ]);

  // ===== 客户 (12) =====
  const custDefs = [
    { code: "QT-C-202606-0001", name: "鸿鹄工业制造有限公司", shortName: "鸿鹄工业", customerType: "ENTERPRISE", industry: "MANUFACTURING", scale: "LARGE", sourceChannel: "REFERRAL", province: "江苏省", city: "苏州市", address: "工业园区东购商街 88 号", contactPhone: "13912340001", contactName: "王志强", contactTitle: "安全总监", finalStatus: "SIGNED", ownerId: sales.id },
    { code: "QT-C-202606-0002", name: "瑞安化工集团股份有限公司", shortName: "瑞安化工", customerType: "ENTERPRISE", industry: "CHEMICAL", scale: "LARGE", sourceChannel: "EXHIBITION", province: "江苏省", city: "常州市", address: "化工园区江水路 168 号", contactPhone: "13912340002", contactName: "赵建国", contactTitle: "EHS 经理", finalStatus: "SIGNED", ownerId: sales.id },
    { code: "QT-C-202606-0003", name: "碧海建设集团有限公司", shortName: "碧海建设", customerType: "ENTERPRISE", industry: "CONSTRUCTION", scale: "LARGE", sourceChannel: "BIDDING", province: "江苏省", city: "南京市", address: "建邺区反审街 12 号", contactPhone: "13912340003", contactName: "孙茂林", contactTitle: "总经理", finalStatus: "NEGOTIATING", ownerId: sales.id },
    { code: "QT-C-202606-0004", name: "远景能源股份有限公司", shortName: "远景能源", customerType: "ENTERPRISE", industry: "ENERGY", scale: "LARGE", sourceChannel: "COLD_VISIT", province: "宁夏回族自治区", city: "银川市", address: "能源路 1 号", contactPhone: "13912340004", contactName: "周工", contactTitle: "生产副总", finalStatus: "SIGNED", ownerId: sales.id },
    { code: "QT-C-202606-0005", name: "锦城矿业有限责任公司", shortName: "锦城矿业", customerType: "ENTERPRISE", industry: "MINING", scale: "MEDIUM", sourceChannel: "GOV_REFERRAL", province: "陕西省", city: "西安市", address: "锦城路 56 号", contactPhone: "13912340005", contactName: "郑总", contactTitle: "安全部长", finalStatus: "NEGOTIATING", ownerId: admin.id },
    { code: "QT-C-202606-0006", name: "顺通运输股份公司", shortName: "顺通运输", customerType: "ENTERPRISE", industry: "TRANSPORTATION", scale: "MEDIUM", sourceChannel: "WEBSITE", province: "江苏省", city: "南通市", address: "物流园 5 号", contactPhone: "13912340006", contactName: "", contactTitle: "", finalStatus: "LEAD", ownerId: sales.id },
    { code: "QT-C-202606-0007", name: "云仓物流科技有限公司", shortName: "云仓物流", customerType: "ENTERPRISE", industry: "WAREHOUSING", scale: "MEDIUM", sourceChannel: "PHONE", province: "上海市", city: "浦东新区", address: "沿海工业区锡德路 320 号", contactPhone: "13912340007", contactName: "冯经理", contactTitle: "仓储主管", finalStatus: "SIGNED", ownerId: sales.id },
    { code: "QT-C-202606-0008", name: "汇金商业贸易有限公司", shortName: "汇金贸易", customerType: "ENTERPRISE", industry: "COMMERCE", scale: "SMALL", sourceChannel: "MEDIA", province: "浙江省", city: "杭州市", address: "滨江区中河上街 26 号", contactPhone: "13912340008", contactName: "", contactTitle: "", finalStatus: "LOST", ownerId: admin.id },
    { code: "QT-C-202606-0009", name: "明德教育投资有限公司", shortName: "明德教育", customerType: "ENTERPRISE", industry: "EDUCATION", scale: "MEDIUM", sourceChannel: "GOV_REFERRAL", province: "北京市", city: "海淀区", address: "中关村大街 18 号", contactPhone: "13912340009", contactName: "杨学之", contactTitle: "投资总监", finalStatus: "SIGNED", ownerId: sales.id },
    { code: "QT-C-202606-0010", name: "市应急管理局", shortName: "市应急局", customerType: "GOV", industry: "GOVERNMENT", scale: null, sourceChannel: "GOV_REFERRAL", province: "江苏省", city: "南京市", address: "应急指挥中心大厦", contactPhone: "13912340010", contactName: "", contactTitle: "", finalStatus: "SIGNED", ownerId: admin.id },
    { code: "QT-C-202606-0011", name: "锦绣酒店管理有限公司", shortName: "锦绣酒店", customerType: "ENTERPRISE", industry: "F_AND_B", scale: "SMALL", sourceChannel: "SOCIAL_MEDIA", province: "江苏省", city: "苏州市", address: "观前街 188 号", contactPhone: "13912340011", contactName: "", contactTitle: "", finalStatus: "FROZEN", ownerId: ops.id },
    { code: "QT-C-202606-0012", name: "青云信息技术有限公司", shortName: "青云科技", customerType: "ENTERPRISE", industry: "IT", scale: "SMALL", sourceChannel: "PARTNER", province: "浙江省", city: "杭州市", address: "未来科技城 9 号楼", contactPhone: "13912340012", contactName: "朱总", contactTitle: "CTO", finalStatus: "NEGOTIATING", ownerId: sales.id },
  ];
  const customers = await Promise.all(custDefs.map((c) => prisma.customer.create({ data: {
    code: c.code, name: c.name, shortName: c.shortName,
    customerType: c.customerType, industry: c.industry, scale: c.scale,
    sourceChannel: c.sourceChannel, province: c.province, city: c.city, address: c.address,
    contactName: c.contactName ?? null, contactTitle: c.contactTitle ?? null, contactPhone: c.contactPhone,
    status: "LEAD", ownerUserId: c.ownerId,
    createdById: c.ownerId, updatedById: c.ownerId
  } })));
  console.log("  ✓ 客户", customers.length, "条");

  // ===== 联系人 (15) =====
  const contactDefs = [
    { custIdx: 0, name: "王志强", title: "安全总监", phone: "13912341001", email: "wangzq@hongu.cn", isPrimary: true },
    { custIdx: 0, name: "李丽", title: "行政经理", phone: "13912341002", email: "lili@hongu.cn", isPrimary: false },
    { custIdx: 1, name: "赵建国", title: "HSE 经理", phone: "13912341003", email: "zhaojg@ruianchem.com", isPrimary: true },
    { custIdx: 2, name: "孙美丽", title: "项目经理", phone: "13912341004", email: "sunml@bihai.cn", isPrimary: true },
    { custIdx: 3, name: "周工", title: "运维副总", phone: "13912341005", email: "zhougong@yuanjing.com", isPrimary: true },
    { custIdx: 3, name: "吴主任", title: "法务主任", phone: "13912341006", email: null, isPrimary: false },
    { custIdx: 4, name: "郑总", title: "副总经理", phone: "13912341007", email: "zhengzong@jinchengmine.com", isPrimary: true },
    { custIdx: 5, name: "钱司机", title: "车队长", phone: "13912341008", email: null, isPrimary: true },
    { custIdx: 6, name: "冯物流", title: "仓储经理", phone: "13912341009", email: "feng@yuncangwl.com", isPrimary: true },
    { custIdx: 7, name: "陈老板", title: "总经理", phone: "13912341010", email: null, isPrimary: true },
    { custIdx: 8, name: "杨校长", title: "副校长", phone: "13912341011", email: "yangxz@mingde-edu.com", isPrimary: true },
    { custIdx: 9, name: "韩科长", title: "监督管理科", phone: "13912341012", email: null, isPrimary: true },
    { custIdx: 10, name: "徐经理", title: "行政经理", phone: "13912341013", email: null, isPrimary: true },
    { custIdx: 11, name: "朱总", title: "CTO", phone: "13912341014", email: "zhuzong@qingyun-it.com", isPrimary: true },
    { custIdx: 11, name: "吕工", title: "信息安全负责人", phone: "13912341015", email: null, isPrimary: false },
  ];
  for (const c of contactDefs) {
    const cust = customers[c.custIdx]!;
    await prisma.contactPerson.create({ data: { customerId: cust.id, name: c.name, title: c.title, phone: c.phone, email: c.email, isPrimary: c.isPrimary } });
  }
  console.log("  ✓ 联系人", contactDefs.length, "条");

  // ===== 跟进 (18) =====
  const followUpDefs = [
    { custIdx: 0, method: "VISIT", content: "上门拜访安全总监，对接上半年安全咨询需求", result: "INTENT", userId: sales.id, daysAgo: 120, nextDays: 7 },
    { custIdx: 0, method: "CALL", content: "确认合同细节，已签订年度服务协议", result: "SIGNED", userId: sales.id, daysAgo: 30, nextDays: null },
    { custIdx: 1, method: "WECHAT", content: "发送化工隐患排查报告模板，待客户确认范围", result: "INTENT", userId: sales.id, daysAgo: 60, nextDays: 5 },
    { custIdx: 1, method: "VISIT", content: "现场察看重大危险源，定制排查方案", result: "SIGNED", userId: sales.id, daysAgo: 20, nextDays: null },
    { custIdx: 2, method: "EMAIL", content: "发送标准化建设技术方案初稿", result: "INTENT", userId: sales.id, daysAgo: 45, nextDays: 3 },
    { custIdx: 3, method: "VISIT", content: "上门介绍风电场应急预案编制服务", result: "INTENT", userId: sales.id, daysAgo: 90, nextDays: 5 },
    { custIdx: 3, method: "WECHAT", content: "二期输变电项目评价报告交付", result: "SIGNED", userId: sales.id, daysAgo: 15, nextDays: null },
    { custIdx: 4, method: "CALL", content: "锡业、谷量安全评价需求申请发起", result: "INTENT", userId: admin.id, daysAgo: 25, nextDays: 7 },
    { custIdx: 5, method: "PHONE", content: "客户正在汇总需求，下周再联系", result: "PENDING", userId: sales.id, daysAgo: 7, nextDays: 7 },
    { custIdx: 6, method: "VISIT", content: "现场仓储检查，形成上报原始记录", result: "INTENT", userId: sales.id, daysAgo: 50, nextDays: 3 },
    { custIdx: 6, method: "EMAIL", content: "发送仓储电气与消防报告", result: "SIGNED", userId: sales.id, daysAgo: 10, nextDays: null },
    { custIdx: 7, method: "CALL", content: "客户表示年内不考虑中仕，退入例行备选名单", result: "NO_INTENT", userId: admin.id, daysAgo: 35, nextDays: null },
    { custIdx: 8, method: "VISIT", content: "校园安全培训上门实地调研", result: "SIGNED", userId: sales.id, daysAgo: 40, nextDays: null },
    { custIdx: 9, method: "VISIT", content: "参加市应急局重点企业检查启动会", result: "SIGNED", userId: admin.id, daysAgo: 100, nextDays: null },
    { custIdx: 11, method: "WECHAT", content: "信息等保咨询需求交流，后续抵现场", result: "INTENT", userId: sales.id, daysAgo: 12, nextDays: 3 },
    { custIdx: 11, method: "EMAIL", content: "发送技术方案初稿与报价", result: "INTENT", userId: sales.id, daysAgo: 5, nextDays: 3 },
    { custIdx: 11, method: "CALL", content: "项目预算谈判，待内部审批", result: "PENDING", userId: sales.id, daysAgo: 2, nextDays: 5 },
    { custIdx: 2, method: "CALL", content: "补送合同审批资料，上门跟进", result: "INTENT", userId: sales.id, daysAgo: 8, nextDays: 2 },
  ];
  const now = Date.now();
  for (const f of followUpDefs) {
    const cust = customers[f.custIdx]!;
    const followAt = new Date(now - f.daysAgo * 86400_000);
    const next = f.nextDays ? new Date(now + f.nextDays * 86400_000) : null;
    await prisma.followUp.create({ data: { customerId: cust.id, userId: f.userId, followAt, method: f.method, content: f.content, nextFollowAt: next, result: f.result } });
  }
  console.log("  ✓ 跟进", followUpDefs.length, "条");

  void admin; void finance; void ops;
  // 临时把所有相关客户从 LEAD 调到 NEGOTIATING（绕开 service 校验，seed 直接走 ORM）
  const negIdxs = [0,1,2,3,4,6,8,9,11];
  await prisma.customer.updateMany({ where: { id: { in: negIdxs.map(i => customers[i].id) } }, data: { status: 'NEGOTIATING' } });

  const _Y = 2026;
  const dayMs = 86400_000;
  const nowMs = Date.now();
  const days = (n) => new Date(nowMs - n * dayMs);
  const plus = (n) => new Date(nowMs + n * dayMs);

  const contractDefs = [[0,"QT-HT-2026-0001","鸿鹄工业 2026 年度安全咨询服务合同","SAFETY_CONSULT",200000,0.06,"BY_PHASE","EFFECTIVE",110,-90,275,"PLAN2"],[0,"QT-HT-2026-0002","鸿鹄工业车间安全培训专项合同","SAFETY_TRAIN",80000,0.06,"LUMP_SUM","EFFECTIVE",80,-60,120,null],[1,"QT-HT-2026-0003","瑞安化工重大危险源隐患排查服务","HAZARD_ANA",320000,0.06,"BY_PHASE","EXECUTING",75,-50,220,"PLAN2B"],[1,"QT-HT-2026-0004","瑞安化工生产安全事故应急预案编制","EMERGENCY_PLAN",150000,0.06,"LUMP_SUM","EFFECTIVE",65,-40,200,null],[2,"QT-HT-2026-0005","碧海建设安全生产标准化建设咨询","SAFETY_CONSULT",280000,0.06,"BY_PHASE","DRAFT",20,30,365,null],[3,"QT-HT-2026-0006","远景能源风电场安全评价报告编制","EVALUATION",800000,0.06,"BY_PHASE","EFFECTIVE",130,-100,260,"PLAN2C"],[3,"QT-HT-2026-0007","远景能源输变电项目应急预案","EMERGENCY_PLAN",450000,0.06,"BY_QUARTER","EXECUTING",60,-30,330,null],[4,"QT-HT-2026-0008","锦城矿业安全培训年度服务","SAFETY_TRAIN",90000,0.06,"LUMP_SUM","DRAFT",10,14,180,null],[6,"QT-HT-2026-0009","云仓物流仓储电气与消防安全检查","SAFETY_CONSULT",120000,0.06,"LUMP_SUM","EFFECTIVE",55,-25,155,null],[8,"QT-HT-2026-0010","明德教育校园安全培训年度合同","SAFETY_TRAIN",60000,0.06,"LUMP_SUM","EFFECTIVE",90,-60,305,null],[8,"QT-HT-2026-0011","明德教育校区等保安全评价","EVALUATION",40000,0.06,"LUMP_SUM","EXECUTING",25,-10,90,null],[9,"QT-HT-2026-0012","市应急局重点企业安全检查服务","SAFETY_CONSULT",240000,0.06,"LUMP_SUM","COMPLETED",150,-120,-10,null],[11,"QT-HT-2026-0013","青云科技信息系统等保咨询","EVALUATION",200000,0.06,"BY_PHASE","DRAFT",5,30,365,null]];
  const plans = {"PLAN2":[{"phase":"上半年","amount":100000},{"phase":"下半年","amount":100000}],"PLAN2B":[{"phase":"首期","amount":160000},{"phase":"尾款","amount":160000}],"PLAN2C":[{"phase":"初评","amount":400000},{"phase":"终评","amount":400000}]};
  const projectDefs = [[0,"鸿鹄工业 2026 上半年安全咨询","安全生产标准化辅导+隐患排查+应急预案",200000,"IN_PROGRESS",-90,90,"sales"],[1,"鸿鹄工业车间三级安全培训","3 场车间级培训 + 在线课程",80000,"IN_PROGRESS",-60,60,"sales"],[2,"瑞安化工重大危险源排查项目","全场 12 处重大危险源评估+治理建议",320000,"IN_PROGRESS",-50,100,"sales"],[3,"瑞安化工生产安全事故应急预案","综合+专项预案编制+演练",150000,"IN_PROGRESS",-40,80,"sales"],[5,"远景能源风电场安全评价项目","3 个风电场+升压站评价报告",800000,"DELIVERED",-100,-5,"sales"],[6,"远景能源输变电项目应急预案","高压输变电应急预案+现场处置",450000,"IN_PROGRESS",-30,150,"sales"],[8,"云仓物流仓储电气与消防检查","园区电气线路+消防设施检查+整改",120000,"IN_PROGRESS",-25,65,"sales"],[9,"明德教育校园安全培训","3 校区集中培训+演练",60000,"ACCEPTED",-60,-10,"sales"],[10,"明德教育校区等保安全评价","信息资产分级+差距分析",40000,"IN_PROGRESS",-10,80,"sales"],[11,"市应急局重点企业安全检查","12 家重点企业现场检查+报告",240000,"CLOSED",-120,-10,"admin"]];
  const invoiceDefs = [[0,"FP-2026-0001","013002600001","VAT_SPECIAL",100000,0.06,"ISSUED",50,45,"COMPANY","鸿鹄工业制造有限公司","91320500MA1NCDF12A","工商银行苏州分行",0],[0,"FP-2026-0002","013002600002","VAT_SPECIAL",100000,0.06,"PENDING_FINANCE",10,null,"COMPANY","鸿鹄工业制造有限公司","91320500MA1NCDF12A","工商银行苏州分行",0],[1,"FP-2026-0003","013002600003","VAT_SPECIAL",80000,0.06,"ISSUED",40,35,"COMPANY","鸿鹄工业制造有限公司","91320500MA1NCDF12A","工商银行苏州分行",0],[2,"FP-2026-0004","013002600011","VAT_SPECIAL",160000,0.06,"ISSUED",30,25,"COMPANY","瑞安化工集团股份有限公司","91320400MA1XYZL88X","建设银行常州分行",1],[3,"FP-2026-0005","013002600012","VAT_SPECIAL",150000,0.06,"ISSUED",30,25,"COMPANY","瑞安化工集团股份有限公司","91320400MA1XYZL88X","建设银行常州分行",1],[5,"FP-2026-0006","013002600021","VAT_SPECIAL",800000,0.06,"ISSUED",80,75,"COMPANY","远景能源股份有限公司","91640000MA1QWER456","中国银行宁夏分行",3],[6,"FP-2026-0007","013002600022","VAT_SPECIAL",450000,0.06,"PENDING_FINANCE",8,null,"COMPANY","远景能源股份有限公司","91640000MA1QWER456","中国银行宁夏分行",3],[8,"FP-2026-0008","013002600031","VAT_ELECTRONIC",120000,0.06,"ISSUED",25,20,"COMPANY","云仓物流科技有限公司","91310115MA1KLOP78Y","招商银行上海分行",6],[9,"FP-2026-0009","013002600041","VAT_SPECIAL",60000,0.06,"ISSUED",60,55,"COMPANY","明德教育投资有限公司","91110108MA1BNM923Z","农业银行北京分行",8],[11,"FP-2026-0010","013002600051","VAT_SPECIAL",240000,0.06,"ISSUED",110,105,"COMPANY","市应急管理局","13320000MB1GOV001","工商银行南京分行",9]];
  const paymentDefs = [[0,0,0,"QT-PAY-2026-0001",100000,40,"BANK_TRANSFER","TR202606100001","工商银行苏州分行","CONFIRMED","上半年咨询费首期"],[0,0,1,"QT-PAY-2026-0002",100000,5,"BANK_TRANSFER",null,null,"PLANNED","下半年咨询费"],[0,1,2,"QT-PAY-2026-0003",80000,30,"BANK_TRANSFER","TR202606200001","工商银行苏州分行","CONFIRMED","车间培训费"],[1,2,3,"QT-PAY-2026-0004",160000,20,"BANK_TRANSFER","TR202606200011","建设银行常州分行","RECONCILED","排查首期款"],[1,3,4,"QT-PAY-2026-0005",150000,15,"BANK_TRANSFER","TR202606200012","建设银行常州分行","CONFIRMED","应急预案全款"],[3,5,5,"QT-PAY-2026-0006",400000,50,"BANK_TRANSFER","TR202606150001","中国银行宁夏分行","CONFIRMED","风电评价首期款"],[3,5,null,"QT-PAY-2026-0007",100000,30,"BANK_TRANSFER","TR202606180001","中国银行宁夏分行","RECONCILED","风电评价预付款（先到票后补）"],[3,6,null,"QT-PAY-2026-0008",50000,8,"WECHAT",null,null,"PLANNED","输变电项目预付款"],[6,8,7,"QT-PAY-2026-0009",120000,18,"BANK_TRANSFER","TR202606220001","招商银行上海分行","CONFIRMED","仓储检查全款"],[8,9,8,"QT-PAY-2026-0010",60000,45,"BANK_TRANSFER","TR202605250001","农业银行北京分行","RECONCILED","校园培训费"],[8,10,null,"QT-PAY-2026-0011",40000,6,"BANK_TRANSFER",null,null,"PLANNED","校区等保评价预付款"],[9,11,9,"QT-PAY-2026-0012",240000,100,"BANK_TRANSFER","TR202603010001","工商银行南京分行","RECONCILED","重点企业检查全款"]];
  const allocDefs = [[0,0,0,100000,"上半年咨询首期/对应项目"],[2,2,1,80000,"车间培训/对应项目"],[3,3,2,160000,"排查首期/对应项目"],[4,4,3,150000,"应急预案/对应项目"],[5,5,4,400000,"风电评价首期/对应项目"],[6,null,4,100000,"风电评价预付款/挂项目"],[8,7,6,120000,"仓储检查/对应项目"],[9,8,7,60000,"校园培训/对应项目"],[11,9,9,240000,"重点企业检查/对应项目"]];
  const annDefs = [["【置顶】2026 年中工作复盘安排","7 月初召开全公司年中复盘，请各业务/技术/财务负责人准备汇报材料。",true,["ADMIN","SALES","FINANCE","OPS"],8],["系统 6 月版本更新说明","本期上线：客户行业与客户来源字典、合同批量审批、发票 PDF 模板优化。",false,["ADMIN","SALES","FINANCE","OPS"],12],["6 月客户回款提醒","本月仍有 3 笔回款未到账，请相关业务负责人跟进：鸿鹄工业 QT-PAY-2026-0002、远景能源 QT-PAY-2026-0008、明德教育 QT-PAY-2026-0011。",false,["SALES","FINANCE","ADMIN"],4],["新版安全评价报告模板上线","风电、化工行业报告模板已更新至 V3.2，请相关项目负责人在新模板中输出。",false,["SALES","ADMIN","OPS"],20],["端午节放假安排","6 月 19-21 日放假 3 天，6 月 22 日（周日）补班。值班联系：业务-张业务、财务-李财务。",false,["ADMIN","SALES","FINANCE","OPS"],25]];
  const msgDefs = [["sales","CONTRACT_PENDING_REVIEW","合同待审批","瑞安化工 QT-HT-2026-0003 已提交审批，请管理员尽快处理。","LINK_C2",null,3],["admin","CONTRACT_PENDING_REVIEW","合同待审批","瑞安化工 QT-HT-2026-0003 已提交审批。","LINK_C2",null,3],["sales","PAYMENT_RECEIVED","回款已确认","鸿鹄工业 QT-PAY-2026-0001（¥100,000）已确认到账。","LINK_P0",1,30],["finance","PAYMENT_RECEIVED","回款已确认","鸿鹄工业 QT-PAY-2026-0001（¥100,000）已确认到账。","LINK_P0",1,30],["admin","PAYMENT_RECEIVED","回款已确认","鸿鹄工业 QT-PAY-2026-0001（¥100,000）已确认到账。","LINK_P0",null,30],["sales","CONTRACT_EXPIRING","合同即将到期","鸿鹄工业 QT-HT-2026-0002（车间培训）将于 60 天内到期，请提前对接续约。","LINK_C1",null,2],["sales","INVOICE_OVERDUE_PAYMENT","发票待回款","鸿鹄工业 FP-2026-0002（¥100,000）开票已 10 天，尚未收到回款，请催收。","LINK_INV1",null,1],["finance","INVOICE_OVERDUE_PAYMENT","发票待回款","鸿鹄工业 FP-2026-0002（¥100,000）开票已 10 天，尚未收到回款。","LINK_INV1",null,1],["sales","PAYMENT_RECEIVED","回款已确认","远景能源 QT-PAY-2026-0006（¥400,000）已确认到账。","LINK_P5",5,10],["admin","PAYMENT_RECEIVED","回款已确认","远景能源 QT-PAY-2026-0006（¥400,000）已确认到账。","LINK_P5",null,10],["sales","PROJECT_DUE","项目待交付","明德教育 QT-P-2026-0007（校园安全培训）即将交付，请确认培训材料齐全。","LINK_PRJ7",null,4],["sales","PAYMENT_RECEIVED","回款已确认","云仓物流 QT-PAY-2026-0009（¥120,000）已确认到账。","LINK_P8",3,8],["finance","PAYMENT_RECEIVED","回款已确认","云仓物流 QT-PAY-2026-0009（¥120,000）已确认到账。","LINK_P8",3,8],["admin","CUSTOMER_INACTIVE","客户长期无跟进","顺通运输（QT-C-202606-0006）已 7 天无跟进记录，请关注。","LINK_CUST5",null,1],["ops","CUSTOMER_INACTIVE","客户长期无跟进","顺通运输（QT-C-202606-0006）已 7 天无跟进记录。","LINK_CUST5",null,1],["sales","PAYMENT_RECEIVED","回款已对账","市应急局 QT-PAY-2026-0012（¥240,000）已对账完成。","LINK_P11",20,60]];
  const seqDefs = [{"prefix":"QT-C-202606","year":2026,"lastValue":12},{"prefix":"QT-HT-2026","year":2026,"lastValue":13},{"prefix":"QT-P-2026","year":2026,"lastValue":10},{"prefix":"QT-PAY-2026","year":2026,"lastValue":12}];

  // ===== 合同 (13) =====
  const contracts = [];
  for (const c of contractDefs) {
    const custIdx = c[0], contractNo = c[1], title = c[2], serviceType = c[3], total = c[4], taxRate = c[5];
    const payMethod = c[6], status = c[7], signDA = c[8], startRel = c[9], endRel = c[10], planKey = c[11];
    const cust = customers[custIdx];
    const signDate = days(signDA);
    const startDate = startRel >= 0 ? plus(startRel) : days(-startRel);
    const endDate = endRel >= 0 ? plus(endRel) : days(-endRel);
    const taxAmount = Math.round((total * taxRate) / (1 + taxRate) * 100) / 100;
    const amountExcl = Math.round((total - taxAmount) * 100) / 100;
    const plan = planKey ? plans[planKey] : null;
    const rec = await prisma.contract.create({ data: {
      contractNo, customerId: cust.id, customerName: cust.name, title, serviceType,
      signDate, startDate, endDate,
      totalAmount: total, taxRate, taxAmount, amountExcludingTax: amountExcl,
      paymentMethod: payMethod,
      installmentPlan: plan ? plan : null,
      status, ownerUserId: cust.ownerUserId,
      attachments: [],
      completionInvoiceRatio: 0.95,
      createdById: cust.ownerUserId, updatedById: cust.ownerUserId
    } });
    contracts.push({ def: c, rec });
  }
  console.log('  done contracts', contracts.length);

  // ===== 合同审批日志 =====
  let reviewLogCount = 0;
  for (const { def, rec } of contracts) {
    if (def[7] === 'DRAFT') continue;
    await prisma.contractReviewLog.create({ data: { contractId: rec.id, reviewerId: admin.id, action: 'SUBMIT' } });
    await prisma.contractReviewLog.create({ data: { contractId: rec.id, reviewerId: admin.id, action: 'APPROVE', comment: '审核通过' } });
    reviewLogCount += 2;
  }
  console.log('  done reviewLogs', reviewLogCount);

  // ===== 项目 (10) =====
  const projects = [];
  for (let i = 0; i < projectDefs.length; i++) {
    const p = projectDefs[i];
    const ctIdx = p[0], name = p[1], scope = p[2], budget = p[3], status = p[4];
    const startRel = p[5], endRel = p[6], mgrEmp = p[7];
    const ct = contracts[ctIdx].rec;
    const mgr = mgrEmp === 'admin' ? admin : (mgrEmp === 'sales' ? sales : (mgrEmp === 'finance' ? finance : ops));
    const startDate = startRel >= 0 ? plus(startRel) : days(-startRel);
    const endDate = endRel >= 0 ? plus(endRel) : days(-endRel);
    const rec = await prisma.project.create({ data: {
      projectNo: 'QT-P-2026-' + String(i + 1).padStart(4, '0'),
      contractId: ct.id, name, serviceScope: scope,
      managerUserId: mgr.id,
      startDate, endDate, budgetAmount: budget, status: status,
      createdById: mgr.id, updatedById: mgr.id
    } });
    projects.push({ def: p, rec });
  }
  console.log('  done projects', projects.length);

  // ===== 项目进度日志 (13) =====
  const progressLogDefs = [
    [0, 30, '启动会+现场调研', 80, 'sales'],
    [0, 65, '中期报告完成，提交评审', 35, 'sales'],
    [1, 60, '完成 2 场车间培训，1 场待排期', 25, 'sales'],
    [2, 40, '首轮 6 处危险源完成评估', 30, 'sales'],
    [2, 80, '完成全部 12 处危险源评估，进入治理建议阶段', 10, 'sales'],
    [3, 50, '综合预案初稿完成，待评审', 20, 'sales'],
    [4, 50, '完成 2 个风电场外业', 60, 'sales'],
    [4, 100, '全部报告交付，等待客户验收', 5, 'sales'],
    [5, 40, '完成现场踏勘，进入报告编制', 20, 'sales'],
    [6, 30, '现场检查启动，资料收集', 18, 'sales'],
    [6, 70, '完成电气与消防双线检查，进入报告', 7, 'sales'],
    [7, 100, '项目完成，已签订验收单', 12, 'sales'],
    [8, 30, '信息资产清册完成', 8, 'sales']
  ];
  for (const pl of progressLogDefs) {
    const pIdx = pl[0], percent = pl[1], remark = pl[2], daysAgo = pl[3], userEmp = pl[4];
    const u = userEmp === 'admin' ? admin : (userEmp === 'sales' ? sales : (userEmp === 'finance' ? finance : ops));
    await prisma.projectProgressLog.create({ data: {
      projectId: projects[pIdx].rec.id, userId: u.id, percent, remark, at: days(daysAgo)
    } });
  }
  console.log('  done progressLogs', progressLogDefs.length);

  // ===== 发票 (10) =====
  const invoices = [];
  for (const inv of invoiceDefs) {
    const ctIdx = inv[0], invoiceNo = inv[1], invoiceCode = inv[2], invType = inv[3], amount = inv[4], taxRate = inv[5];
    const status = inv[6], applyDA = inv[7], issueDA = inv[8], titleType = inv[9], titleName = inv[10];
    const taxNo = inv[11], bankName = inv[12], custIdx = inv[13];
    const ct = contracts[ctIdx].rec;
    const cust = customers[custIdx];
    const taxAmount = Math.round((amount * taxRate) / (1 + taxRate) * 100) / 100;
    const amountExcl = Math.round((amount - taxAmount) * 100) / 100;
    const rec = await prisma.invoice.create({ data: {
      invoiceNo, invoiceCode, contractId: ct.id, customerId: cust.id, customerName: cust.name,
      invoiceType: invType, amount, taxRate, taxAmount, amountExcludingTax: amountExcl,
      applyDate: days(applyDA),
      expectedIssueDate: plus(3),
      actualIssueDate: issueDA !== null ? days(issueDA) : null,
      titleType, titleName, taxNo, bankName,
      bankAccount: taxNo ? '6222021234567890123' : null,
      address: taxNo ? '（同客户注册地址）' : null,
      phone: cust.contactPhone ? cust.contactPhone : null,
      status, applicantUserId: sales.id, financeUserId: status === 'ISSUED' ? finance.id : null,
      reviewedAt: status === 'ISSUED' ? days(issueDA) : null,
      createdById: sales.id, updatedById: sales.id
    } });
    invoices.push({ def: inv, rec });
  }
  console.log('  done invoices', invoices.length);

  // ===== 发票审计日志 =====
  let invAuditCount = 0;
  for (const { def, rec } of invoices) {
    const isIssued = def[6] === 'ISSUED';
    await prisma.invoiceAuditLog.create({ data: {
      invoiceId: rec.id, actorId: sales.id, action: 'INVOICE_CREATE', after: { status: 'DRAFT' }, comment: '新建发票申请'
    } });
    await prisma.invoiceAuditLog.create({ data: {
      invoiceId: rec.id, actorId: sales.id, action: 'INVOICE_SUBMIT', before: { status: 'DRAFT' }, after: { status: 'PENDING_FINANCE' }, comment: '提交财务审核'
    } });
    invAuditCount += 2;
    if (isIssued) {
      await prisma.invoiceAuditLog.create({ data: {
        invoiceId: rec.id, actorId: finance.id, action: 'INVOICE_ISSUE', before: { status: 'PENDING_FINANCE' }, after: { status: 'ISSUED' }, comment: '审核通过，开具发票'
      } });
      invAuditCount += 1;
    }
  }
  console.log('  done invoiceAudits', invAuditCount);

  // ===== 回款 (12) =====
  const payments = [];
  for (const p of paymentDefs) {
    const custIdx = p[0], ctIdx = p[1], invIdx = p[2], paymentNo = p[3], amount = p[4], recvDA = p[5];
    const method = p[6], ref = p[7], bank = p[8], status = p[9], remark = p[10];
    const cust = customers[custIdx];
    const ct = contracts[ctIdx].rec;
    const inv = invIdx !== null ? invoices[invIdx].rec : null;
    const rec = await prisma.payment.create({ data: {
      paymentNo, customerId: cust.id, contractId: ct.id, invoiceId: inv ? inv.id : null,
      amount, receivedAt: days(recvDA), method,
      bankRefNo: ref, bankName: bank, remark: remark,
      status, recorderUserId: finance.id,
      reconcileUserId: status === 'RECONCILED' ? finance.id : null,
      reconciledAt: status === 'RECONCILED' ? days(recvDA - 2) : null,
      createdById: finance.id, updatedById: finance.id
    } });
    payments.push({ def: p, rec });
  }
  console.log('  done payments', payments.length);

  // ===== 付款核销分配 (9) =====
  for (const a of allocDefs) {
    const pIdx = a[0], invIdx = a[1], prjIdx = a[2], amount = a[3], remark = a[4];
    await prisma.paymentAllocation.create({ data: {
      paymentId: payments[pIdx].rec.id,
      invoiceId: invIdx !== null ? invoices[invIdx].rec.id : null,
      projectId: prjIdx !== null ? projects[prjIdx].rec.id : null,
      amount, remark: remark
    } });
  }
  console.log('  done allocations', allocDefs.length);

  // ===== 客户最终状态 =====
  for (let i = 0; i < custDefs.length; i++) {
    const c = custDefs[i];
    await prisma.customer.update({ where: { id: customers[i].id }, data: { status: c.finalStatus, updatedById: c.ownerId } });
  }
  console.log('  done customerFinalStatus', custDefs.length);

  // ===== 公告 (5) =====
  for (const a of annDefs) {
    const title = a[0], content = a[1], pinned = a[2], targetRoles = a[3], daysAgo = a[4];
    await prisma.announcement.create({ data: {
      title, content, publishUserId: admin.id,
      publishAt: days(daysAgo), effectiveFrom: days(daysAgo), effectiveTo: plus(60),
      pinned: pinned, targetRoles: targetRoles
    } });
  }
  console.log('  done announcements', annDefs.length);

  // ===== 消息 (16) =====
  const linkMap = {
    LINK_C2: () => ({ contractId: contracts[2].rec.id, contractNo: 'QT-HT-2026-0003', href: '/contracts/' + contracts[2].rec.id }),
    LINK_C1: () => ({ contractId: contracts[1].rec.id, contractNo: 'QT-HT-2026-0002', href: '/contracts/' + contracts[1].rec.id }),
    LINK_INV1: () => ({ invoiceId: invoices[1].rec.id, invoiceNo: 'FP-2026-0002', href: '/invoices/' + invoices[1].rec.id }),
    LINK_P0: () => ({ paymentId: payments[0].rec.id, paymentNo: 'QT-PAY-2026-0001', href: '/payments/' + payments[0].rec.id }),
    LINK_P5: () => ({ paymentId: payments[5].rec.id, paymentNo: 'QT-PAY-2026-0006', href: '/payments/' + payments[5].rec.id }),
    LINK_P8: () => ({ paymentId: payments[8].rec.id, paymentNo: 'QT-PAY-2026-0009', href: '/payments/' + payments[8].rec.id }),
    LINK_P11: () => ({ paymentId: payments[11].rec.id, paymentNo: 'QT-PAY-2026-0012', href: '/payments/' + payments[11].rec.id }),
    LINK_PRJ7: () => ({ projectId: projects[7].rec.id, projectNo: 'QT-P-2026-0008', href: '/projects/' + projects[7].rec.id }),
    LINK_CUST5: () => ({ customerId: customers[5].id, customerCode: 'QT-C-202606-0006', href: '/customers/' + customers[5].id })
  };
  for (const m of msgDefs) {
    const receiverEmp = m[0], type = m[1], title = m[2], content = m[3], linkKey = m[4];
    const readDA = m[5], daysAgo = m[6];
    const u = receiverEmp === 'admin' ? admin : (receiverEmp === 'sales' ? sales : (receiverEmp === 'finance' ? finance : ops));
    const link = linkKey ? linkMap[linkKey]() : null;
    await prisma.message.create({ data: {
      receiverUserId: u.id, type, title, content, link: link,
      readAt: readDA !== null ? days(readDA) : null,
      createdAt: days(daysAgo)
    } });
  }
  console.log('  done messages', msgDefs.length);

  // ===== Sequence 续号点 =====
  for (const s of seqDefs) {
    await prisma.sequence.upsert({
      where: { prefix_year: { prefix: s.prefix, year: s.year } },
      update: { lastValue: s.lastValue },
      create: s
    });
  }
  console.log('  done sequences', seqDefs.length);

}

async function main() {
  const roleDefs = [
    { code: "ADMIN", name: "管理员", description: "系统管理员" },
    { code: "SALES", name: "业务人员", description: "负责客户/合同/项目推进" },
    { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
    { code: "OPS", name: "行政人员", description: "基础信息维护" }
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

  const passwordHash = await bcrypt.hash("123456", 10);
  const userDefs = [
    { employeeNo: "admin",   name: "系统管理员", email: "admin@qt.com",   roleCode: "ADMIN",   deptCode: "tech" },
    { employeeNo: "sales",   name: "张业务",     email: "sales@qt.com",   roleCode: "SALES",   deptCode: "biz" },
    { employeeNo: "finance", name: "李财务",     email: "finance@qt.com", roleCode: "FINANCE", deptCode: "fin" },
    { employeeNo: "ops",     name: "王行政",     email: "ops@qt.com",     roleCode: "OPS",     deptCode: "biz" }
  ] as const;
  for (const u of userDefs) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.roleCode } });
    const dept = u.deptCode
      ? await prisma.department.findUnique({ where: { code: u.deptCode } })
      : null;
    await prisma.user.upsert({
      where: { employeeNo: u.employeeNo },
      update: dept ? { departmentId: dept.id } : {},
      create: {
        employeeNo: u.employeeNo,
        name: u.name,
        email: u.email,
        passwordHash,
        roleId: role.id,
        departmentId: dept?.id ?? null
      }
    });
  }

  const dictDefs: Array<{ category: string; code: string; label: string; sort: number }> = [
    { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "安全咨询", sort: 1 },
    { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "安全培训", sort: 2 },
    { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "隐患排查", sort: 3 },
    { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案", sort: 4 },
    { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评价", sort: 5 },
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

  await seedBusinessData();
  console.log("✅ Seed 完成：4 角色 + 4 账号（密码 123456）+ 5 部门 + 15 类字典 + 12 客户 + 15 联系人 + 18 跟进 + 13 合同 + 10 项目 + 10 发票 + 12 回款 + 5 公告 + 16 消息 + 4 Sequence 续号点");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
