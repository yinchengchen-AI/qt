#!/usr/bin/env tsx
/**
 * 字典同步器: 把 types/enums.ts 里的状态机 enum 同步到 Dictionary 表
 *
 * 用途: 避免 enum 改了之后手工同步多份 (prisma/seed.ts / scripts/shared/seed-dicts.ts / Dictionary)
 * 单点真理 = types/enums.ts (编译期常量) + lib/status.ts (label 翻译)
 *
 * 规则:
 *   - enum 数组里有 + Dictionary 缺 → insert (isActive=true)
 *   - enum 数组里有 + Dictionary 在 → update label/sort, isActive=true
 *   - enum 数组里没 + Dictionary isActive=true → isActive=false (软停用, 留作历史)
 *   - enum 数组里没 + Dictionary isActive=false → noop
 *
 * 用法:
 *   pnpm sync-dict                       # 同步所有白名单 enum
 *   pnpm sync-dict --dry-run             # 只看不写
 *   pnpm sync-dict --only=CONTRACT_STATUS  # 只同步指定类目
 *
 * 幂等, 可重复跑. 不物理删行 (留作历史), 彻底清理走一次性 admin 工具.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter, log: ["error"] });

const DRY_RUN = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;

type SyncTarget = {
  /** Dictionary.category */
  category: string;
  /** 状态 code 数组 (单点真理) */
  codes: readonly string[];
  /** code -> 中文 label (跟 lib/status.ts 保持一致) */
  labelMap: Record<string, string>;
  /** code -> sort 序号 (省略则按数组下标 +1) */
  sortMap?: Record<string, number>;
};

/**
 * 白名单: 哪些 enum 要跟 Dictionary 同步.
 * 增删时改这里即可; 业务字典 (CUSTOMER_TYPE 等) 仍由 admin 在页面维护, 不进白名单.
 */
const TARGETS: readonly SyncTarget[] = [
  {
    category: "CONTRACT_STATUS",
    codes: ["DRAFT", "ACTIVE", "CLOSED"],
    labelMap: {
      DRAFT: "草稿",
      ACTIVE: "生效中",
      CLOSED: "已完结"
    }
  }
];

async function main() {
  const targets = ONLY ? TARGETS.filter((t) => t.category === ONLY) : TARGETS;
  if (targets.length === 0) {
    console.error(`未找到类目 ${ONLY}, 可选: ${TARGETS.map((t) => t.category).join(", ")}`);
    process.exit(1);
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalDisabled = 0;

  for (const target of targets) {
    console.log(`\n[${target.category}] 期望 ${target.codes.length} 条 active code:`);
    console.log("  " + target.codes.map((c) => `${c}=${target.labelMap[c]}`).join(", "));

    const existing = await prisma.dictionary.findMany({
      where: { category: target.category }
    });

    const codeSet = new Set(target.codes);
    const existingByCode = new Map(existing.map((d) => [d.code, d]));

    for (let i = 0; i < target.codes.length; i++) {
      const code = target.codes[i]!;
      const label = target.labelMap[code] ?? code;
      const sort = target.sortMap?.[code] ?? i + 1;
      const row = existingByCode.get(code);

      if (!row) {
        console.log(`  + insert ${code} (${label})`);
        if (!DRY_RUN) {
          await prisma.dictionary.create({
            data: { category: target.category, code, label, sort, isActive: true }
          });
        }
        totalInserted++;
      } else {
        const needUpdate =
          row.label !== label ||
          row.sort !== sort ||
          row.isActive !== true;
        if (needUpdate) {
          console.log(`  ~ update ${code}: label=${row.label}->${label}, sort=${row.sort}->${sort}, isActive=${row.isActive}->true`);
          if (!DRY_RUN) {
            await prisma.dictionary.update({
              where: { id: row.id },
              data: { label, sort, isActive: true }
            });
          }
          totalUpdated++;
        }
      }
    }

    // 软停用: 数组里没有但 Dictionary 是 active 的
    for (const row of existing) {
      if (!codeSet.has(row.code) && row.isActive) {
        console.log(`  - disable ${row.code} (${row.label}) — 不在 enum 数组里`);
        if (!DRY_RUN) {
          await prisma.dictionary.update({
            where: { id: row.id },
            data: { isActive: false }
          });
        }
        totalDisabled++;
      }
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY-RUN] " : ""}完成: +${totalInserted}  ~${totalUpdated}  -${totalDisabled}`);
  if (DRY_RUN) console.log("(未实际写入, 去掉 --dry-run 执行)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
