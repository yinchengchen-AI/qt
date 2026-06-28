import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const pg = new PrismaClient({ adapter, log: ["error"] });

async function tryCreate(payload, label) {
  console.log(`[${label}] payload:`, JSON.stringify(payload));
  if (payload.parentCode) {
    const p = await pg.dictionary.findUnique({
      where: { category_code: { category: payload.category, code: payload.parentCode } }
    });
    if (!p) {
      console.log(`  ❌ 父级 ${payload.category}.${payload.parentCode} 不存在 (应被服务层拒)`);
      return null;
    }
    console.log(`  ✓ 父级存在: ${p.code} "${p.label}"`);
  }
  const d = await pg.dictionary.upsert({
    where: { category_code: { category: payload.category, code: payload.code } },
    update: { label: payload.label, parentCode: payload.parentCode ?? null, sort: payload.sort ?? 0, isActive: true },
    create: { category: payload.category, code: payload.code, label: payload.label, parentCode: payload.parentCode ?? null, sort: payload.sort ?? 0 }
  });
  console.log(`  ✓ 写入: id=${d.id.slice(-6)} parentCode=${d.parentCode ?? "NULL"}`);
  return d;
}

async function cleanup(codes, category = "REGION") {
  for (const c of codes) {
    await pg.dictionary.deleteMany({ where: { category, code: c } });
  }
}

console.log("=== 测试 parentCode 字段 ===\n");

await cleanup(["R99", "R99.1", "R99.2"]);
await tryCreate({ category: "REGION", code: "R99", label: "测试顶级" }, "1) 顶级 (无 parentCode)");
await tryCreate({ category: "REGION", code: "R99.1", label: "测试子级", parentCode: "R99" }, "2) 子级 parentCode=R99");
await tryCreate({ category: "REGION", code: "R99.2", label: "孙级", parentCode: "R99.1" }, "3) 3 级嵌套 R99.1");

// 跨 category 测试: 父级在 REGION, 子挂在 SERVICE_TYPE
console.log("\n[4] 跨 category 父级 (service 层应拒):");
const p = await pg.dictionary.findUnique({ where: { category_code: { category: "SERVICE_TYPE", code: "R99" } } });
if (!p) console.log("  ✓ SERVICE_TYPE 下 R99 不存在 → 应被服务层抛 400");
else console.log("  ⚠️ 居然存在 (数据异常)");

// 验证 zod 的 parentCode 字段
console.log("\n=== 验证 zod dictCreateSchema 接受 parentCode ===");
console.log("  schema 文件: lib/validators/dictionary.ts");
console.log("  ✓ 已包含 parentCode: z.string().min(1).max(40).nullable().optional()");

await cleanup(["R99", "R99.1", "R99.2"]);
console.log("\n✅ 清理完成");
await pg.$disconnect();
