import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const pg = new PrismaClient({ adapter, log: ["error"] });

// 1) ALTER TABLE
await pg.$executeRawUnsafe('ALTER TABLE "Dictionary" ADD COLUMN IF NOT EXISTS "parentCode" TEXT');
console.log("✓ ALTER TABLE added parentCode");

// 2) CREATE INDEX
await pg.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Dictionary_category_parentCode_code_key" ON "Dictionary"("category", "parentCode", "code")');
console.log("✓ CREATE UNIQUE INDEX (category, parentCode, code)");

await pg.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Dictionary_category_parentCode_idx" ON "Dictionary"("category", "parentCode")');
console.log("✓ CREATE INDEX (category, parentCode)");

// 3) 回填 REGION 26 条
// 顶级 R{N}: parentCode=NULL (已)
// 子级 R{N}.{X}: parentCode=R{N}
// 孙级 R{N}.{X}.{Y}: parentCode=R{N}.{X} (本批 26 条没有)
await pg.$executeRawUnsafe(`UPDATE "Dictionary" SET "parentCode" = NULL WHERE "category" = 'REGION' AND "code" ~ '^R[0-9]+$'`);
await pg.$executeRawUnsafe(`UPDATE "Dictionary" SET "parentCode" = REGEXP_REPLACE("code", '\\.[0-9]+$', '') WHERE "category" = 'REGION' AND "code" ~ '^R[0-9]+\\.[0-9]+$'`);

const updated = await pg.$queryRawUnsafe(`SELECT code, "parentCode" FROM "Dictionary" WHERE "category" = 'REGION' ORDER BY code LIMIT 30`);
console.log("✓ REGION backfill:");
for (const r of updated) {
  console.log(`   ${r.code.padEnd(10)} | parentCode=${r.parentCode ?? 'NULL'}`);
}

const total = await pg.dictionary.count({ where: { category: "REGION" } });
console.log(`\n✓ REGION total: ${total}`);

await pg.$disconnect();
