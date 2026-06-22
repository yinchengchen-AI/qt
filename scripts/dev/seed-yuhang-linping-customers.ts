#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * dev 专用: 100 个真实业务客户 (杭州市余杭区 + 临平区 各个镇街)
 *
 * 用途:
 *   - dev 环境 UI / e2e 用真实数据
 *   - 给 dashboard / statistics / 列表 / 详情页提供靠谱的样本量, 避免空表导致截图惨白
 *   - 测试 SALES 行级隔离 (按 owner 轮转分配), 客户类型/状态/规模筛选用
 *
 * 行为:
 *   - 100 个 = 20 个 "tier" × 5 个, 每 tier 锁定 (district, town) 配对
 *   - 同一镇街可以出现多次 (代表该镇街下有多个客户群), 总数 100 不变
 *   - 幂等: 按 code 前缀 DEV-YHLP- + 序号去重 (e.g. DEV-YHLP-0001); 已存在则 skip
 *   - 5 个 dev 用户轮转当 owner (admin / sales / finance / ops / expert)
 *   - customerType / industry / scale / status / source 走字典表真实 code,
 *     保证后续筛选项 / 翻译 / 统计全部能命中
 *   - createdAt / updatedAt 散在过去 6 个月内, 让统计图看着真实
 *   - 仅 dev 用, 不会动其他 customer; 跑错就再跑一次, 不会越写越多
 *
 * 用法:
 *   pnpm seed:dev-customers
 *   # 加 --reset 清掉所有 DEV-YHLP-* 后重建 (慎用, 仅 dev)
 *   pnpm seed:dev-customers --reset
 */
import { prisma } from "@/lib/prisma";
import "dotenv/config";

// 5 个 dev 测试用户的 employeeNo, ownerUserId 轮转
const DEV_USERS = ["admin", "sales", "finance", "ops", "expert"] as const;
const CODE_PREFIX = "DEV-YHLP-";
const TOTAL = 100;
// 每 tier 5 个客户; 20 tier × 5 = 100
const PER_TIER = 5;

// 余杭 (按 lib/geo-divisions.ts 的实际归属; 2021 临平分家后部分街道归临平, 6 个归余杭)
type Tier = { district: string; town: string };
// 12 个余杭 + 8 个临平 = 20 tier; 每个镇街正好一个 tier, 各 5 个客户
const TIERS: Tier[] = [
  // 余杭 12 tier
  { district: "余杭区", town: "南苑街道" },
  { district: "余杭区", town: "东湖街道" },
  { district: "余杭区", town: "星桥街道" },
  { district: "余杭区", town: "乔司街道" },
  { district: "余杭区", town: "运河街道" },
  { district: "余杭区", town: "塘栖镇" },
  { district: "余杭区", town: "仁和街道" },
  { district: "余杭区", town: "瓶窑镇" },
  { district: "余杭区", town: "径山镇" },
  { district: "余杭区", town: "黄湖镇" },
  { district: "余杭区", town: "鸬鸟镇" },
  { district: "余杭区", town: "百丈镇" },
  // 临平 8 tier
  { district: "临平区", town: "临平街道" },
  { district: "临平区", town: "南苑街道" },
  { district: "临平区", town: "东湖街道" },
  { district: "临平区", town: "星桥街道" },
  { district: "临平区", town: "乔司街道" },
  { district: "临平区", town: "运河街道" },
  { district: "临平区", town: "崇贤街道" },
  { district: "临平区", town: "塘栖镇" },
];

// 行业词 (按 customerType 选)
// 制造业 / 化工 / IT / 商业 / 物流等真实行业, 命名后缀风格统一
const ENTERPRISE_BRANDS = [
  "精密机械", "智能装备", "电子科技", "信息技术", "网络科技",
  "新材料", "新能源", "汽车零部件", "纺织印染", "服装服饰",
  "食品加工", "生物医药", "医疗器械", "光学仪器", "环保科技",
  "包装印刷", "建材", "智能家居", "物联网", "云计算",
  "商业贸易", "进出口", "物流", "仓储", "文化创意",
  "金融科技", "电子商贸", "智能制造", "五金机电", "塑料制品"
];
const ENTERPRISE_TYPES = ["有限公司", "股份有限公司", "有限责任公司"];

// GOV 命名: 镇/街道 + 职能 + 办公室/中心/所
const GOV_FUNCTIONS = [
  "便民服务中心", "综合服务中心", "城市管理", "安全生产监督",
  "市场监管", "卫生服务", "社区卫生服务", "文化体育服务",
  "公共法律服务", "劳动保障监察", "综合治理", "教育服务",
  "退役军人服务", "统计事务", "档案管理"
];
const GOV_SUFFIXES = ["办公室", "服务中心", "管理所", "工作站"];

// OTHER: 个体户 / 合作社 / 社会团体
const OTHER_BRANDS = [
  "种养殖", "果蔬", "茶叶", "农家乐", "民宿",
  "物流服务部", "便利店", "餐饮店", "图文工作室", "信息咨询"
];

// 联系人
const FAMILY_NAMES = ["王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴", "徐", "孙", "马", "朱", "胡", "林", "何", "高", "梁", "宋"];
const GIVEN_NAMES = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀英", "霞", "平", "刚", "桂英"];
const ENTERPRISE_TITLES = ["总经理", "副总经理", "经理", "副经理", "主管", "厂长", "总监", "主任"];
const GOV_TITLES = ["主任", "副主任", "科长", "副科长", "所长", "副所长", "站长", "办事员"];

// 杭州市内常见道路名, 按区风格略分
const ROADS_HANGZHOU = [
  "人民路", "中山路", "建国路", "解放路", "迎宾路", "兴国路", "文一西路", "文二路",
  "文三路", "天目山路", "莫干山路", "湖墅南路", "凤起路", "庆春路", "延安路", "解放路",
  "古墩路", "紫荆花路", "教工路", "玉古路", "求是路", "曙光路", "保俶路", "武林路"
];
const INDUSTRIAL_ROADS = [
  "科技大道", "文一西路", "工业路", "兴业街", "创业路", "智造大道", "创新路",
  "兴元路", "兴旺路", "发展大道", "振兴路", "高新一路", "高新二路", "经一路"
];

// 种子: 固定随机数, 跑两次结果一致 (避免 e2e 截图闪烁)
let _seed = 0xdeadbeef;
function rand(): number {
  _seed = (_seed * 16807) % 0x7fffffff;
  return _seed / 0x7fffffff;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function randPhone(): string {
  // 138 / 139 / 158 / 188 + 8 位; 故意不真实, 仅 dev 演示
  const prefix = pick(["138", "139", "158", "188", "186", "131", "135"]);
  let rest = "";
  for (let i = 0; i < 8; i++) rest += randInt(0, 9).toString();
  return prefix + rest;
}
function randName(): string {
  return pick(FAMILY_NAMES) + pick(GIVEN_NAMES) + (rand() < 0.5 ? "" : pick(GIVEN_NAMES));
}
function randDateAgo(maxDays: number): Date {
  // 散在过去 maxDays 天内; 给列表 / 统计看着真实
  const days = rand() * maxDays;
  return new Date(Date.now() - days * 86400_000);
}

// 名称生成器: 杭州市 + 区/镇街特征 + 行业词 + 公司后缀
function genEnterpriseName(town: string, brand: string): string {
  // 部分带"区名"或"镇街名"作为前缀, 体现地域感
  const prefix = pick([
    "杭州", "杭州余杭", "杭州临平", town, `${town.replace(/街道$|镇$/, "")}工业园`, ""
  ]);
  return `${prefix}${brand}${pick(ENTERPRISE_TYPES)}`.replace(/^${pick(ENTERPRISE_TYPES)}/, `${brand}${pick(ENTERPRISE_TYPES)}`);
}
function genGovName(town: string, fn: string, suffix: string): string {
  // "杭州市余杭区XX街道办事处" / "XX镇XX办公室" 等
  const templates = [
    () => `杭州市余杭区${town}${fn}${suffix}`,
    () => `杭州市临平区${town}${fn}${suffix}`,
    () => `${town}${fn}${suffix}`,
    () => `杭州市${town}${fn}${suffix}`
  ];
  return pick(templates)();
}
function genOtherName(town: string, brand: string): string {
  return `杭州${town.replace(/街道$|镇$/, "")}${brand}${pick(["经营部", "合作社", "服务部", "店", "工作室", "中心"])}`;
}
function genAddress(town: string, isGov: boolean, isEnterprise: boolean): string {
  const road = isEnterprise
    ? pick(INDUSTRIAL_ROADS)
    : pick(ROADS_HANGZHOU);
  const num = randInt(1, 999);
  const suffix = pick(["号", "号", "号", "弄8号"]); // 加点权重
  return `${town}${road}${num}${suffix}`;
}

async function ensureDevUsers(): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({
    where: { employeeNo: { in: [...DEV_USERS] }, deletedAt: null },
    select: { id: true, employeeNo: true }
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.employeeNo, r.id);
  for (const e of DEV_USERS) {
    if (!map.has(e)) {
      throw new Error(
        `dev 用户 ${e} 不存在, 先跑 pnpm seed:dev-users 建好 (admin/sales/finance/ops/expert 5 个账号)`
      );
    }
  }
  return map;
}

async function getExistingCodes(): Promise<Set<string>> {
  const rows = await prisma.customer.findMany({
    where: { code: { startsWith: CODE_PREFIX } },
    select: { code: true }
  });
  return new Set(rows.map((r) => r.code));
}

type CustomerType = "ENTERPRISE" | "GOV" | "OTHER";
const TYPE_DIST: CustomerType[] = (() => {
  // 80% ENTERPRISE / 15% GOV / 5% OTHER, 100 个 = 80 / 15 / 5
  const arr: CustomerType[] = [];
  for (let i = 0; i < 80; i++) arr.push("ENTERPRISE");
  for (let i = 0; i < 15; i++) arr.push("GOV");
  for (let i = 0; i < 5; i++) arr.push("OTHER");
  return arr;
})();

const ENTERPRISE_INDUSTRY: Record<CustomerType, string[]> = {
  ENTERPRISE: [
    "MANUFACTURING", "CHEMICAL", "CONSTRUCTION", "TRANSPORTATION",
    "WAREHOUSING", "COMMERCE", "IT", "SERVICES", "ENERGY",
    "HEALTHCARE", "EDUCATION", "F_AND_B", "OTHER"
  ],
  GOV: ["GOVERNMENT", "EDUCATION", "HEALTHCARE", "SERVICES"],
  OTHER: ["AGRICULTURE", "F_AND_B", "SERVICES", "OTHER"]
};
const SCALE_DIST = (() => {
  // ENTERPRISE 才有 scale: 10/30/45/15 (大/中/小/微)
  const arr: (string | null)[] = [];
  for (let i = 0; i < 10; i++) arr.push("LARGE");
  for (let i = 0; i < 30; i++) arr.push("MEDIUM");
  for (let i = 0; i < 45; i++) arr.push("SMALL");
  for (let i = 0; i < 15; i++) arr.push("MICRO");
  return arr;
})();
const STATUS_DIST = (() => {
  // 50% SIGNED / 30% NEGOTIATING / 20% LEAD; 都不放 LOST / FROZEN
  const arr: string[] = [];
  for (let i = 0; i < 50; i++) arr.push("SIGNED");
  for (let i = 0; i < 30; i++) arr.push("NEGOTIATING");
  for (let i = 0; i < 20; i++) arr.push("LEAD");
  return arr;
})();
const SOURCE_DIST = [
  "EXHIBITION", "REFERRAL", "WEBSITE", "PHONE", "COLD_VISIT",
  "BIDDING", "PARTNER", "MEDIA", "SOCIAL_MEDIA",
  "GOV_REFERRAL", "REPEAT", "OTHER"
];

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doReset = args.includes("--reset");
  const dbg = args.includes("--debug");

  if (doReset) {
    const r = await prisma.customer.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
    console.log(`[RESET] 删除已有 ${r.count} 条 DEV-YHLP-* 客户`);
  }

  const userMap = await ensureDevUsers();
  const existing = await getExistingCodes();
  if (existing.size > 0 && !doReset) {
    console.log(`[SKIP] 已存在 ${existing.size} 条 DEV-YHLP-* 客户; 要重建请加 --reset`);
  }

  const userIds = DEV_USERS.map((e) => userMap.get(e)!);
  const customerTypes = [...TYPE_DIST].sort(() => rand() - 0.5); // 洗牌
  const scales = [...SCALE_DIST].sort(() => rand() - 0.5);
  const statuses = [...STATUS_DIST].sort(() => rand() - 0.5);
  const sources = [...SOURCE_DIST].sort(() => rand() - 0.5);

  let created = 0;
  let skipped = 0;
  const perTierCount: Record<string, number> = {};

  for (let i = 0; i < TOTAL; i++) {
    const code = `${CODE_PREFIX}${pad(i + 1, 4)}`;
    if (existing.has(code)) {
      skipped++;
      continue;
    }

    const tier = TIERS[Math.floor(i / PER_TIER) % TIERS.length]!;
    const tierKey = `${tier.district}/${tier.town}`;
    perTierCount[tierKey] = (perTierCount[tierKey] ?? 0) + 1;

    const customerType = customerTypes[i % customerTypes.length]!;
    const industry = pick(ENTERPRISE_INDUSTRY[customerType]);
    const scale = customerType === "ENTERPRISE" ? scales[i % scales.length] : null;
    const status = statuses[i % statuses.length]!;
    const sourceChannel = sources[i % sources.length]!;
    const ownerUserId = userIds[i % userIds.length]!;
    const createdById = ownerUserId;
    const updatedById = ownerUserId;

    let name: string;
    let title: string;
    let phone: string;
    let addr: string;
    if (customerType === "ENTERPRISE") {
      const brand = pick(ENTERPRISE_BRANDS);
      name = genEnterpriseName(tier.town, brand);
      title = pick(ENTERPRISE_TITLES);
      phone = randPhone();
      addr = genAddress(tier.town, false, true);
    } else if (customerType === "GOV") {
      const fn = pick(GOV_FUNCTIONS);
      const suf = pick(GOV_SUFFIXES);
      name = genGovName(tier.town, fn, suf);
      title = pick(GOV_TITLES);
      phone = randPhone();
      addr = genAddress(tier.town, true, false);
    } else {
      const brand = pick(OTHER_BRANDS);
      name = genOtherName(tier.town, brand);
      title = pick(ENTERPRISE_TITLES); // 个体户 / 合作社也是经理/负责人
      phone = randPhone();
      addr = genAddress(tier.town, false, false);
    }

    const createdAt = randDateAgo(180); // 过去半年
    const updatedAt = randDateAgo(30);  // 过去一月

    if (dbg) {
      console.log(`  [${code}] ${tierKey} -> ${name} (${customerType}/${status}/${industry})`);
    }

    await prisma.customer.create({
      data: {
        code,
        name,
        shortName: null,
        unifiedSocialCreditCode: null, // mock 数据不造真实的统一社会信用代码
        customerType,
        industry,
        scale,
        province: "浙江省",
        city: "杭州市",
        district: tier.district,
        address: addr,
        town: tier.town,
        contactName: randName(),
        contactTitle: title,
        contactPhone: phone,
        sourceChannel,
        ownerUserId,
        status,
        createdById,
        updatedById,
        createdAt,
        updatedAt
      }
    });
    created++;
  }

  console.log(`\n[OK] dev 客户 seed 完成: created=${created}, skipped=${skipped}, target=${TOTAL}`);
  console.log(`[INFO] 密码/账号源: 5 个 dev 用户轮转 owner (admin/sales/finance/ops/expert)`);
  console.log(`[INFO] 按 code 前缀 'DEV-YHLP-' 查询; --reset 强制清重建`);
  console.log("[INFO] 打开 http://localhost:3000/customers 可看到 100 条按镇街分布的客户");
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
