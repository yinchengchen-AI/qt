#!/usr/bin/env tsx
/**
 * 生产轻量字典 seed (不污染空库)。唯一定义源 = scripts/shared/dict-defs.ts,
 * 与 prisma/seed.ts 共用, 不再双份维护。
 *
 * 用法:
 *   pnpm seed-dicts
 */
import { prisma } from "@/lib/prisma";
import { DICT_DEFS } from "./dict-defs";

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
