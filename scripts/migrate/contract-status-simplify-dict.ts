#!/usr/bin/env tsx
/**
 * 合同状态机简化: Dictionary 表迁移
 *
 * 旧值 (7 条 active): DRAFT / PENDING_REVIEW / EFFECTIVE / EXECUTING / SUSPENDED / COMPLETED / TERMINATED / EXPIRED
 * 新值 (3 条 active): DRAFT / ACTIVE / CLOSED
 *
 * 策略: 旧 code 全部软停用 (isActive=false), 新 3 条 upsert. 不物理删, 留作历史.
 * 配套的 Contract.status 数据迁移在 prisma/migrations/<ts>_contract_status_simplify/migration.sql
 *
 * 用法:
 *   pnpm tsx scripts/migrate/contract-status-simplify-dict.ts           # 实际写入
 *   pnpm tsx scripts/migrate/contract-status-simplify-dict.ts --dry-run # 只看不写
 *
 * 幂等, 重复跑结果一致.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config();

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter, log: ["error"] });

const NEW_CODES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
const NEW_LABELS: Record<(typeof NEW_CODES)[number], string> = {
  DRAFT: "草稿",
  ACTIVE: "生效中",
  CLOSED: "已完结"
};
const NEW_SORTS: Record<(typeof NEW_CODES)[number], number> = {
  DRAFT: 1,
  ACTIVE: 2,
  CLOSED: 3
};

async function main() {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "EXEC"}] 合同状态字典简化: 7 条 active → 3 条 active`);

  // 1) 软停用所有非新值的 active code
  const toDisable = await prisma.dictionary.findMany({
    where: {
      category: "CONTRACT_STATUS",
      isActive: true,
      code: { notIn: [...NEW_CODES] }
    }
  });
  console.log(`  - 软停用 ${toDisable.length} 条旧 code:`);
  for (const r of toDisable) {
    console.log(`      ${r.code} (${r.label})`);
  }
  if (!DRY_RUN && toDisable.length > 0) {
    await prisma.dictionary.updateMany({
      where: {
        category: "CONTRACT_STATUS",
        isActive: true,
        code: { notIn: [...NEW_CODES] }
      },
      data: { isActive: false }
    });
  }

  // 2) Upsert 3 条新 code
  for (const code of NEW_CODES) {
    const label = NEW_LABELS[code];
    const sort = NEW_SORTS[code];
    const existing = await prisma.dictionary.findUnique({
      where: { category_code: { category: "CONTRACT_STATUS", code } }
    });
    if (!existing) {
      console.log(`  + insert ${code} (${label})`);
      if (!DRY_RUN) {
        await prisma.dictionary.create({
          data: { category: "CONTRACT_STATUS", code, label, sort, isActive: true }
        });
      }
    } else {
      const needUpdate =
        existing.label !== label || existing.sort !== sort || !existing.isActive;
      if (needUpdate) {
        console.log(`  ~ update ${code}: label=${existing.label}->${label}, sort=${existing.sort}->${sort}, isActive=${existing.isActive}->true`);
        if (!DRY_RUN) {
          await prisma.dictionary.update({
            where: { id: existing.id },
            data: { label, sort, isActive: true }
          });
        }
      } else {
        console.log(`  = noop ${code} (${label})`);
      }
    }
  }

  // 3) 断言: active 必须是 3 条
  const activeCount = await prisma.dictionary.count({
    where: { category: "CONTRACT_STATUS", isActive: true }
  });
  if (activeCount !== 3) {
    throw new Error(
      `CONTRACT_STATUS active rows = ${activeCount}, 期望 3. ${DRY_RUN ? "(dry-run 不会真的写, 这只是预测)" : ""}`
    );
  }
  console.log(`\n✅ 完成. CONTRACT_STATUS active = ${activeCount} 条 (期望 3)`);
  if (DRY_RUN) console.log("(dry-run 未实际写入, 去掉 --dry-run 执行)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
