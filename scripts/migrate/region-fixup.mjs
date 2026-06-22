import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import mysql from "mysql2/promise";
import { config } from "dotenv";
config();

const adapter = new PrismaPg(process.env.DATABASE_URL);
const pg = new PrismaClient({ adapter, log: ["error"] });

const my = await mysql.createConnection({
  host: "127.0.0.1", port: 3307, user: "root", password: "root123",
  database: "fineuicorecontext", charset: "utf8mb4"
});

const [areas] = await my.query("SELECT * FROM areas ORDER BY ID");
const byId = new Map(areas.map(a => [a.ID, a]));

// label 规则:
// - 顶级 (ParentID=NULL): label = self.Name (例: "杭州市", "临平区")
// - 子级 (parent.ParentID=NULL): label = self.Name  (例: "余杭区", "临平区")
// - 孙级 (parent 有 parent): label = "${parent.Name} · ${self.Name}"  (例: "余杭区 · 径山镇")
function newLabel(area) {
  if (area.ParentID == null) return area.Name;
  const parent = byId.get(area.ParentID);
  if (!parent) return area.Name;
  if (parent.ParentID == null) return area.Name;  // 子级
  return `${parent.Name} · ${area.Name}`;  // 孙级
}

// sort 规则:
// - 顶级按 SortIndex 排
// - 子级紧跟父级后 100 + SortIndex
// - 孙级紧跟子级后 200 + SortIndex
function newSort(area) {
  if (area.ParentID == null) return area.SortIndex;
  const parent = byId.get(area.ParentID);
  if (!parent) return 9999;
  if (parent.ParentID == null) return 100 + area.SortIndex;
  return 200 + area.SortIndex;
}

// 顶级按 SortIndex 升序，孙级按 sort 计算
let updated = 0;
let unchanged = 0;
for (const a of areas) {
  const newCode = a.ParentID == null ? `R${a.ID}` : `R${a.ParentID}.${a.ID}`;
  const newLabelStr = newLabel(a);
  const newSortVal = newSort(a);
  // 查旧 dict
  const old = await pg.dictionary.findUnique({
    where: { category_code: { category: "REGION", code: newCode } }
  });
  if (!old) { unchanged++; continue; }
  if (old.label === newLabelStr && old.sort === newSortVal) { unchanged++; continue; }
  await pg.dictionary.update({
    where: { id: old.id },
    data: { label: newLabelStr, sort: newSortVal }
  });
  updated++;
}
console.log(`REGION: updated=${updated}, unchanged=${unchanged}, total=${areas.length}`);

await my.end();
await pg.$disconnect();
