#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — 一次性迁移脚本, 不走严格类型, 见 scripts/prod/ 其它脚本风格
/**
 * 客户字段离线补全 (生产环境)
 *
 * 目标 (4 类可离线推导的字段):
 *   1. shortName  从 name 剥离前缀(杭州/浙江/(园区))与后缀(有限公司/...) — ENTERPRISE 才推
 *   2. city       把误填成区名的"临平区/余杭区/未知"统一改回"杭州市"
 *   3. district   根据 town 或旧 city 回填 (余杭区 / 临平区 / 其它区)
 *   4. town       根据 address 匹配标准镇街 (21 个: 余杭12 + 临平9)
 *
 * 不补 (等企查查/天眼查 API):
 *   - unifiedSocialCreditCode, industry, scale, contactTitle
 *
 * 行为:
 *   - 默认 dry-run: 只打印统计 + 样例, 不写库
 *   - --apply: 写前先建备份表 "Customer_backup_<timestamp>", 然后单事务批量 UPDATE
 *   - 任何 UPDATE 都不会改 createdById / createdAt / ownerUserId
 *
 * 用法:
 *   pnpm tsx scripts/prod/enrich-customers-offline.ts            # dry-run
 *   pnpm tsx scripts/prod/enrich-customers-offline.ts --apply    # 写库 (会建备份表)
 */
import { prisma } from "@/lib/prisma";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");

// ── 离线字典 ──────────────────────────────────────────────────────────────

// 21 个标准镇街 (余杭12 + 临平9); 来自 lib/china-divisions.ts
const TOWN_TO_DISTRICT: Record<string, string> = {
  // 余杭区 (330110)
  "余杭街道": "余杭区",
  "闲林街道": "余杭区",
  "仓前街道": "余杭区",
  "中泰街道": "余杭区",
  "五常街道": "余杭区",
  "良渚街道": "余杭区",
  "仁和街道": "余杭区",
  "瓶窑镇": "余杭区",
  "径山镇": "余杭区",
  "黄湖镇": "余杭区",
  "鸬鸟镇": "余杭区",
  "百丈镇": "余杭区",
  // 临平区 (330113)
  "临平街道": "临平区",
  "东湖街道": "临平区",
  "南苑街道": "临平区",
  "星桥街道": "临平区",
  "乔司街道": "临平区",
  "运河街道": "临平区",
  "崇贤街道": "临平区",
  "塘栖镇": "临平区",
  "临平经济技术开发区": "临平区"
};

// address → town 映射 (对最常见的"裸镇街名"做归一化)
const ADDRESS_TO_TOWN: Record<string, string> = Object.fromEntries(
  Object.keys(TOWN_TO_DISTRICT).flatMap((full) => {
    const short = full.replace(/(街道|镇)$/, ""); // "运河" / "塘栖" 等
    return [
      [short, full],
      [full, full]
    ];
  })
);
// 特殊: "开发区" → 临平经济技术开发区
ADDRESS_TO_TOWN["开发区"] = "临平经济技术开发区";
// 特殊: "老余杭" 老派写法 → 余杭街道
ADDRESS_TO_TOWN["老余杭"] = "余杭街道";

// 城市名清洗
const DIRTY_CITY_TO_CLEAN: Record<string, string> = {
  "临平区": "杭州市",
  "余杭区": "杭州市"
};
const CLEAN_CITY = "杭州市";

const COMPANY_SUFFIXES_SORTED = ["股份有限责任公司", "股份有限公司", "有限责任公司", "有限公司", "公司"];

// name 前缀 (按长度从长到短排, 避免 "杭州" 误吞 "杭州" 开头的核心词)
const NAME_PREFIXES = ["（园区）", "(园区)", "杭州市", "杭州", "浙江省", "浙江", "余杭区", "临平区"];

// ── 推导函数 ──────────────────────────────────────────────────────────────

function deriveShortName(name: string, customerType: string): string | null {
  if (customerType !== "ENTERPRISE") return null;
  let s = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of NAME_PREFIXES) {
      if (s.startsWith(p)) {
        s = s.slice(p.length);
        changed = true;
        break;
      }
    }
  }
  // 去掉 "XX分公司" 这种分公司后缀
  // 找最长 SUFFIX 位置; 如果 SUFFIX 后面还跟着 "X分公司" (X=1-6字), 一起剥掉
  for (const suf of COMPANY_SUFFIXES_SORTED) {
    const idx = s.lastIndexOf(suf);
    if (idx >= 0) {
      s = s.slice(0, idx);
      break;
    }
  }
  // 兜底: "股份有限公司" 拆完可能留 "股份", ENTERPRISE 的尾巴无意义
  s = s.replace(/股份$/, "");
  s = s.trim();
  if (!s) return null;
  if (s.length > 50) return s.slice(0, 50);
  return s;
}

function deriveTown(address: string | null): string | null {
  if (!address) return null;
  const a = address.trim();
  if (ADDRESS_TO_TOWN[a]) return ADDRESS_TO_TOWN[a];
  // 尝试从 address 开头匹配镇街 (例如 "闲林闲兴路15号" → 闲林街道)
  for (const key of Object.keys(ADDRESS_TO_TOWN)) {
    if (a.startsWith(key)) return ADDRESS_TO_TOWN[key];
  }
  return null;
}

function deriveDistrict(
  oldCity: string,
  oldDistrict: string | null,
  newTown: string | null
): string | null {
  // 1) 如果 town 已知, 用 town 决定
  if (newTown && TOWN_TO_DISTRICT[newTown]) return TOWN_TO_DISTRICT[newTown];
  // 2) 否则看旧 district
  if (oldDistrict === "余杭区" || oldDistrict === "临平区") return oldDistrict;
  // 3) 否则从旧 city 推 (老数据里 city 字段塞的是区名)
  if (oldCity === "余杭区" || oldCity === "临平区") return oldCity;
  if (oldCity === "西湖区" || oldCity === "萧山区" || oldCity === "临安区") return oldCity;
  return oldDistrict ?? null;
}

function deriveCity(
  name: string,
  oldCity: string,
  district: string | null,
  province: string | null
): string {
  if (DIRTY_CITY_TO_CLEAN[oldCity]) return DIRTY_CITY_TO_CLEAN[oldCity];
  if (oldCity && oldCity !== "未知") return oldCity; // 已是 "杭州市" 等
  // oldCity = "未知" 的情况: 按 name + province 推断
  for (const h of NAME_PROVINCE_HINTS) {
    if (name.startsWith(h.prefix) && h.city) return h.city;
  }
  if (province === "浙江省" && district && district.endsWith("区")) return CLEAN_CITY;
  return oldCity; // 推断不出来就保留 "未知"
}

// 按公司名识别省份; 杭州/浙江 → 浙江省, 江西 → 江西省, ...
const NAME_PROVINCE_HINTS: { prefix: string; province: string; city?: string }[] = [
  { prefix: "杭州", province: "浙江省", city: "杭州市" },
  { prefix: "浙江", province: "浙江省", city: "杭州市" },
  { prefix: "宁波", province: "浙江省", city: "宁波市" },
  { prefix: "温州", province: "浙江省", city: "温州市" },
  { prefix: "嘉兴", province: "浙江省", city: "嘉兴市" },
  { prefix: "湖州", province: "浙江省", city: "湖州市" },
  { prefix: "绍兴", province: "浙江省", city: "绍兴市" },
  { prefix: "金华", province: "浙江省", city: "金华市" },
  { prefix: "衢州", province: "浙江省", city: "衢州市" },
  { prefix: "舟山", province: "浙江省", city: "舟山市" },
  { prefix: "台州", province: "浙江省", city: "台州市" },
  { prefix: "丽水", province: "浙江省", city: "丽水市" },
  { prefix: "上海", province: "上海市", city: "上海市" },
  { prefix: "北京", province: "北京市", city: "北京市" },
  { prefix: "天津", province: "天津市", city: "天津市" },
  { prefix: "重庆", province: "重庆市", city: "重庆市" },
  { prefix: "深圳", province: "广东省", city: "深圳市" },
  { prefix: "广州", province: "广东省", city: "广州市" },
  { prefix: "南京", province: "江苏省", city: "南京市" },
  { prefix: "苏州", province: "江苏省", city: "苏州市" },
  { prefix: "江西", province: "江西省" }, // city 留 未知, 没有 11 个地市的稳定 hint
  { prefix: "厦门", province: "福建省", city: "厦门市" },
  { prefix: "福州", province: "福建省", city: "福州市" }
];
function deriveProvince(
  name: string,
  oldProvince: string,
  newCity: string
): string {
  if (oldProvince && oldProvince !== "未知") return oldProvince;
  for (const h of NAME_PROVINCE_HINTS) {
    if (name.startsWith(h.prefix)) return h.province;
  }
  if (newCity === "杭州市" || newCity === "宁波市" || newCity === "温州市") return "浙江省";
  return oldProvince; // 兜底: 不要瞎猜
}

// ── 主流程 ────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  customerType: string;
  province: string;
  city: string;
  district: string | null;
  address: string | null;
  town: string | null;
};

type Change = {
  id: string;
  code: string;
  field: string;
  before: string | null;
  after: string | null;
};

async function loadAll(): Promise<Row[]> {
  return prisma.customer.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      customerType: true,
      province: true,
      city: true,
      district: true,
      address: true,
      town: true
    }
  });
}

function computeChanges(row: Row): Change[] {
  const changes: Change[] = [];

  // 1) shortName
  const newShort = deriveShortName(row.name, row.customerType);
  if (newShort && newShort !== row.shortName) {
    changes.push({ id: row.id, code: row.code, field: "shortName", before: row.shortName, after: newShort });
  }

  // 2) town
  const newTown = deriveTown(row.address);
  if (newTown && newTown !== row.town) {
    changes.push({ id: row.id, code: row.code, field: "town", before: row.town, after: newTown });
  }

  // 3) district (depends on town)
  const newDistrict = deriveDistrict(row.city, row.district, newTown ?? row.town);
  if (newDistrict !== row.district) {
    changes.push({ id: row.id, code: row.code, field: "district", before: row.district, after: newDistrict });
  }

  // 4) province 先算 (city 推断依赖它)
  const tentativeProvince = deriveProvince(row.name, row.province, row.city);
  const newProvince = (row.province && row.province !== "未知") ? row.province : tentativeProvince;

  // 5) city (depends on district + province)
  const newCity = deriveCity(row.name, row.city, newDistrict, newProvince);
  if (newCity !== row.city) {
    changes.push({ id: row.id, code: row.code, field: "city", before: row.city, after: newCity });
  }

  if (newProvince !== row.province) {
    changes.push({ id: row.id, code: row.code, field: "province", before: row.province, after: newProvince });
  }

  return changes;
}

async function main() {
  console.log(`==> 加载客户数据...`);
  const rows = await loadAll();
  console.log(`==> 共 ${rows.length} 条 (deletedAt IS NULL)`);

  console.log(`==> 推导变更...`);
  const allChanges: Change[] = [];
  for (const r of rows) {
    allChanges.push(...computeChanges(r));
  }

  // 统计
  const byField: Record<string, number> = {};
  for (const c of allChanges) byField[c.field] = (byField[c.field] ?? 0) + 1;
  console.log(`==> 待变更: ${allChanges.length} 条 / ${rows.length} 客户`);
  console.table(byField);

  // 每个字段抽 5 条样例
  const fields = Array.from(new Set(allChanges.map((c) => c.field)));
  for (const f of fields) {
    const samples = allChanges.filter((c) => c.field === f).slice(0, 5);
    console.log(`\n── 样例: ${f} (${samples.length}/${byField[f]}) ──`);
    for (const s of samples) {
      console.log(`  [${s.code}]  ${JSON.stringify(s.before)} -> ${JSON.stringify(s.after)}`);
    }
  }

  if (!APPLY) {
    console.log(`\n==> DRY-RUN 完成, 没有写库. 加 --apply 才会真写.`);
    return;
  }

  // 备份
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const backup = `Customer_backup_${ts}`;
  console.log(`\n==> 建备份表: ${backup}`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE "${backup}" AS SELECT * FROM "Customer" WHERE "deletedAt" IS NULL;`
  );
  const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "${backup}";`
  );
  console.log(`==> 备份 ${count} 条`);

  // 写库 — 按字段批量 UPDATE (每字段 1 条 SQL, 避免 8000+ 次往返)
  const writeFields = Array.from(new Set(allChanges.map((c) => c.field)));
  console.log(`==> 开始 UPDATE (按字段批量, ${writeFields.length} 条 SQL, 事务 timeout 60s)...`);
  await prisma.$transaction(async (tx) => {
    for (const f of writeFields) {
      const rows = allChanges.filter((c) => c.field === f);
      if (rows.length === 0) continue;
      const placeholders = rows.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(",");
      const params = rows.flatMap((r) => [r.id, r.after]);
      const sql = `
        UPDATE "Customer" AS c
        SET "${f}" = v.new, "updatedAt" = NOW()
        FROM (VALUES ${placeholders}) AS v(id, new)
        WHERE c.id = v.id AND c."deletedAt" IS NULL
      `;
      const r = await tx.$executeRawUnsafe(sql, ...params);
      console.log(`    [${f}] updated ${r} (expected ${rows.length})`);
    }
  }, { timeout: 60_000 });

  console.log(`==> 完成. 备份表 "${backup}" 保留, 不要立刻 drop, 出问题回滚用:`);
  console.log(`   INSERT INTO "Customer" SELECT * FROM "${backup}" WHERE id = ...;`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
