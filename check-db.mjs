import { prisma } from "./lib/prisma.js";
const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log("Tables:", tables.map(t => t.table_name).join(", "));
try {
  const depts = await prisma.department.findMany();
  console.log("\nDepartments (" + depts.length + "):");
  for (const d of depts) console.log(`  ${d.code} | ${d.name} | active=${d.isActive} | parent=${d.parentId ?? "-"}`);
} catch (e) {
  console.log("Department table error:", e.message);
}
const users = await prisma.user.findMany({ where: { deletedAt: null }, include: { department: true } });
console.log("\nUsers:");
for (const u of users) {
  console.log(`  ${u.employeeNo} (${u.name}) | deptId=${u.departmentId ?? "null"} | dept=${u.department?.name ?? "-"}`);
}
process.exit(0);
