import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import mysql from "mysql2/promise";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const pg = new PrismaClient({ adapter, log: ["error"] });

const my = await mysql.createConnection({
  host: "127.0.0.1", port: 3307, user: "root", password: "root123",
  database: "fineuicorecontext", charset: "utf8mb4"
});

const [areas] = await my.query("SELECT * FROM areas ORDER BY ID");
const byId = new Map(areas.map(a => [a.ID, a]));

// 每个 area 的真正 code = 走父链到顶级
function trueCode(area) {
  // 顶级: R{ID}
  if (area.ParentID == null) return `R${area.ID}`;
  // 子级: R{父 ID}.{自己 ID}  (跟原 areaToCode 编码一致,父 ID 拼在前面)
  return `R${area.ParentID}.${area.ID}`;
}

// 每个 area 的真正 parentCode = 父级的 trueCode
function trueParentCode(area, byId) {
  if (area.ParentID == null) return null;
  const parent = byId.get(area.ParentID);
  if (!parent) return null;
  return trueCode(parent, byId);
}

let updated = 0;
let unchanged = 0;
for (const a of areas) {
  const newCode = trueCode(a);
  const newParent = trueParentCode(a, byId);
  const old = await pg.dictionary.findUnique({
    where: { category_code: { category: "REGION", code: newCode } }
  });
  if (!old) { unchanged++; continue; }
  if (old.parentCode === newParent) { unchanged++; continue; }
  await pg.dictionary.update({
    where: { id: old.id },
    data: { parentCode: newParent }
  });
  updated++;
}
console.log(`parentCode 修正: updated=${updated}, unchanged=${unchanged}`);

// 抽样
const sample = await pg.dictionary.findMany({
  where: { category: "REGION" }, take: 10,
  select: { code: true, label: true, parentCode: true },
  orderBy: { code: "asc" }
});
console.log("\nREGION 当前:");
for (const r of sample) {
  console.log(`  ${r.code.padEnd(10)} parentCode=${(r.parentCode ?? "NULL").padEnd(8)} | ${r.label}`);
}

await my.end();
await pg.$disconnect();
